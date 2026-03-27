import axios from 'axios';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { MainR2, SubInstance, File, UploadQueue, AuthToken } from './schema.js';
import dotenv from 'dotenv';
import fs from 'fs';
import FormData from 'form-data';
import { pipeline } from 'stream/promises'; // Use promises for easier async/await
dotenv.config({ path: "cert.env" });


const JWT_SECRET = process.env.JWT_SECRET || 'main-secret-key-change-in-production';


let r2Client = null;
let r2Config = null;

async function initializeR2Client() {
    try {
        const bucket = await MainR2.findOne({ status: 'active' });
        if (!bucket) {
            console.log('[R2] ⚠️  No active R2 bucket configured yet');
            return null;
        }

        r2Config = bucket;
        r2Client = new S3Client({
            region: 'auto',
            endpoint: bucket.endpoint,
            credentials: {
                accessKeyId: bucket.access_key_id,
                secretAccessKey: bucket.secret_access_key
            }
        });

        console.log('[R2] ✅ R2 client initialized');
        console.log('[R2]    Bucket: ' + bucket.bucket_name);
        console.log('[R2]    Endpoint: ' + bucket.endpoint + '\n');

        return r2Client;
    } catch (err) {
        console.error('[R2] ❌ Failed to initialize R2 client:', err.message);
        return null;
    }
}

// Initialize on startup
initializeR2Client();

// ============ R2 OPERATIONS ============


async function uploadToMainR2(fileName, filePath, hash, title) {
    try {
        if (!r2Client || !r2Config) {
            await initializeR2Client();
        }

        if (!r2Client) {
            throw new Error('R2 client not initialized');
        }

        const key = `uploads/${hash}`;

        // Get file stats for logging size correctly
        const stats = fs.statSync(filePath);
        const fileSizeInBytes = stats.size;

        // Sanitize title for R2 metadata headers
        const sanitizedTitle = (title || fileName)
            .substring(0, 100)
            .replace(/[^a-zA-Z0-9\-_\s]/g, '_')
            .replace(/\s+/g, '_');

        console.log(`[R2-UPLOAD] 📤 Uploading to Main R2 (Streaming from Disk)`);
        console.log(`[R2-UPLOAD]    Bucket: ${r2Config.bucket_name}`);
        console.log(`[R2-UPLOAD]    Key: ${key}`);
        console.log(`[R2-UPLOAD]    Size: ${(fileSizeInBytes / 1024 / 1024).toFixed(2)} MB`);

        // Create a ReadStream instead of using a Buffer
        const fileStream = fs.createReadStream(filePath);

        const command = new PutObjectCommand({
            Bucket: r2Config.bucket_name,
            Key: key,
            Body: fileStream, // 🚨 Streaming happens here
            ContentLength: fileSizeInBytes, // Recommended for streams
            ContentType: 'application/octet-stream',
            Metadata: {
                'original-title': sanitizedTitle,
                'original-filename': fileName.substring(0, 100)
            }
        });

        await r2Client.send(command);

        console.log(`[R2-UPLOAD] ✅ Uploaded successfully to Main R2`);
        console.log(`[R2-UPLOAD]    Path: ${r2Config.bucket_name}/${key}\n`);

        return {
            bucket: r2Config.bucket_name,
            key: key,
            success: true
        };
    } catch (err) {
        console.error(`[R2-UPLOAD] ❌ Upload failed: ${err.message}`);
        throw err;
    }
}

async function fetchFromMainR2(key) {
    try {
        const command = new GetObjectCommand({
            Bucket: r2Config.bucket_name,
            Key: key
        });

        const response = await r2Client.send(command);
        const tempPath = `/tmp/${key.replace(/\//g, '_')}`; // Create a unique temp filename

        // Use pipeline to stream from R2 directly to Disk
        await pipeline(response.Body, fs.createWriteStream(tempPath));

        return tempPath; // Return the path to the file on disk
    } catch (err) {
        console.error('[R2-FETCH] ❌ Download failed:', err.message);
        throw err;
    }
}
export async function hashLargeFile(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256'); // Change to md5 if that's what you used previously
        const stream = fs.createReadStream(filePath);

        stream.on('error', err => reject(err));
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

async function deleteFromMainR2(hash) {
    try {
        if (!r2Client || !r2Config) {
            await initializeR2Client();
        }

        if (!r2Client) {
            throw new Error('R2 client not initialized');
        }

        const key = `uploads/${hash}`;

        console.log(`[R2-DELETE] 🗑️  Deleting from Main R2`);
        console.log(`[R2-DELETE]    Bucket: ${r2Config.bucket_name}`);
        console.log(`[R2-DELETE]    Key: ${key}`);

        const command = new DeleteObjectCommand({
            Bucket: r2Config.bucket_name,
            Key: key
        });

        await r2Client.send(command);

        console.log(`[R2-DELETE] ✅ Deleted successfully from Main R2\n`);

        return true;
    } catch (err) {
        console.error(`[R2-DELETE] ❌ Delete failed: ${err.message}`);
        throw err;
    }
}

// ============ GET SIGNED URL FROM SUB-INSTANCE ============

// Inside modules.js on the MAIN instance
async function getSignedUrlFromSubInstance(subInstance, hash) {
    try {
        const response = await axios.get(`${subInstance.url}/api/signed-url`, {
            params: { hash },
            headers: {
                // This 'SUB_ADMIN_KEY' value must match the 'ADMIN_KEY' on the sub-instance
                'Authorization': `Bearer ${process.env.SUB_ADMIN_KEY}`
            }
        });
        return response.data;
    } catch (err) {
        console.error(`[R2-UTILS] ❌ Node ${subInstance.node_id} rejected auth:`, err.message);
        return null;
    }
}

// ============ TRANSFER LIMIT FUNCTIONS ============

async function resetMonthlyLimitIfNeeded(subInstance) {
    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7);  // "2025-03"

    // Check if month has changed
    if (subInstance.monthly_transfer.current_month !== currentMonth) {
        console.log(`[TRANSFER-LIMIT] 🔄 Resetting monthly limit for ${subInstance.node_id}`);
        console.log(`[TRANSFER-LIMIT]    Old month: ${subInstance.monthly_transfer.current_month}`);
        console.log(`[TRANSFER-LIMIT]    New month: ${currentMonth}`);

        // Reset for new month
        await SubInstance.updateOne(
            { node_id: subInstance.node_id },
            {
                'monthly_transfer.current_month': currentMonth,
                'monthly_transfer.data_transferred': 0,
                'monthly_transfer.reset_date': new Date(now.getFullYear(), now.getMonth() + 1, 1)
            }
        );

        console.log(`[TRANSFER-LIMIT] ✅ Monthly limit reset for ${subInstance.node_id}\n`);

        // Refresh the instance
        return await SubInstance.findOne({ node_id: subInstance.node_id });
    }

    return subInstance;
}

async function checkMonthlyTransferLimit(subInstance, fileSizeBytes) {
    // Reset if month has changed
    const updated = await resetMonthlyLimitIfNeeded(subInstance);

    const currentUsage = updated.monthly_transfer.data_transferred;
    const limit = updated.monthly_transfer.limit_bytes;
    const wouldExceed = currentUsage + fileSizeBytes;

    console.log(`[TRANSFER-LIMIT] 📊 Checking ${updated.node_id} monthly limit`);
    console.log(`[TRANSFER-LIMIT]    Current: ${(currentUsage / 1024 / 1024 / 1024).toFixed(2)}GB`);
    console.log(`[TRANSFER-LIMIT]    File size: ${(fileSizeBytes / 1024 / 1024 / 1024).toFixed(2)}GB`);
    console.log(`[TRANSFER-LIMIT]    Would be: ${(wouldExceed / 1024 / 1024 / 1024).toFixed(2)}GB`);
    console.log(`[TRANSFER-LIMIT]    Limit: ${(limit / 1024 / 1024 / 1024).toFixed(2)}GB`);

    if (wouldExceed > limit) {
        console.log(`[TRANSFER-LIMIT] ❌ Would exceed limit!\n`);
        return {
            allowed: false,
            reason: `Monthly transfer limit exceeded for ${updated.node_id}`,
            current: currentUsage,
            limit: limit,
            remaining: Math.max(0, limit - currentUsage)
        };
    }

    console.log(`[TRANSFER-LIMIT] ✅ Within limit\n`);
    return {
        allowed: true,
        current: currentUsage,
        limit: limit,
        remaining: limit - currentUsage
    };
}

async function updateMonthlyTransferUsage(nodeId, bytesAdded) {
    try {
        await SubInstance.updateOne(
            { node_id: nodeId },
            { $inc: { 'monthly_transfer.data_transferred': bytesAdded } }
        );

        const updated = await SubInstance.findOne({ node_id: nodeId });
        const usage = updated.monthly_transfer.data_transferred;
        const limit = updated.monthly_transfer.limit_bytes;

        console.log(`[TRANSFER-LIMIT] 📈 Updated ${nodeId} usage`);
        console.log(`[TRANSFER-LIMIT]    Added: ${(bytesAdded / 1024 / 1024 / 1024).toFixed(2)}GB`);
        console.log(`[TRANSFER-LIMIT]    Total: ${(usage / 1024 / 1024 / 1024).toFixed(2)}GB / ${(limit / 1024 / 1024 / 1024).toFixed(2)}GB\n`);
    } catch (err) {
        console.error(`[TRANSFER-LIMIT] ❌ Error updating usage: ${err.message}`);
    }
}

// ============ AUTH MIDDLEWARE ============

function verifyToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });

    try {
        jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

// ============ API TOKEN VERIFICATION (PUBLIC ACCESS) ============
// Verify API tokens stored in AuthToken collection
// Tokens can be created in dashboard and shared with external instances
async function verifyApiToken(req, res, next) {
    try {
        // Get token from header: "Bearer token_value"
        const authHeader = req.headers['authorization'];
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing or invalid authorization header' });
        }

        const tokenValue = authHeader.substring(7); // Remove "Bearer "

        // Find token in database
        const tokenDoc = await AuthToken.findOne({
            token: tokenValue,
            status: 'active'
        });

        if (!tokenDoc) {
            return res.status(401).json({ error: 'Invalid or revoked token' });
        }

        // Check expiration if set
        if (tokenDoc.expires_at && tokenDoc.expires_at < new Date()) {
            return res.status(401).json({ error: 'Token has expired' });
        }

        // Update last_used timestamp
        await AuthToken.updateOne(
            { token: tokenValue },
            { last_used: new Date() }
        );

        // Attach token info to request for logging
        req.apiToken = tokenDoc;
        next();
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}

// ============ UTILITY FUNCTIONS ============


async function getActiveSubInstances() {
    return await SubInstance.find({ status: 'active' });
}

async function getSubInstanceSpace(subInstance) {
    try {
        const url = `${subInstance.url}/api/status`;
        console.log(`[SPACE-CHECK] 🔍 Checking ${subInstance.node_id}`);
        console.log(`[SPACE-CHECK]    URL: ${url}`);

        const response = await axios.get(url, { timeout: 5000 });

        console.log(`[SPACE-CHECK] ✅ ${subInstance.node_id} responded`);
        console.log(`[SPACE-CHECK]    Free Space: ${(response.data.stats.total_free_space / 1024 / 1024 / 1024).toFixed(2)} GB`);

        const updateResult = await SubInstance.updateOne(
            { node_id: subInstance.node_id },
            {
                free_space: response.data.stats.total_free_space,
                total_space: response.data.stats.total_max_storage,
                file_count: response.data.stats.total_files,
                r2_buckets: response.data.stats.total_buckets,
                last_heartbeat: new Date(),
                status: 'active'
            }
        );

        console.log(`[SPACE-CHECK] 💾 Database updated: ${updateResult.modifiedCount} document(s) modified`);

        return response.data.stats;
    } catch (err) {
        console.error(`[SPACE-CHECK] ❌ ${subInstance.node_id} unreachable: ${err.message}`);

        await SubInstance.updateOne(
            { node_id: subInstance.node_id },
            { status: 'inactive' }
        );

        return null;
    }
}

async function getSubInstanceSpaces() {
    const subInstances = await getActiveSubInstances();
    const spaces = {};

    for (const instance of subInstances) {
        const data = await getSubInstanceSpace(instance);
        if (data) {
            spaces[instance.node_id] = {
                free_space: data.total_free_space,
                total_space: data.total_max_storage,
                file_count: data.total_files,
                instance
            };
        }
    }

    return spaces;
}

async function getSuitableNodes(fileSize) {
    // 1. Get the health/space status of all nodes
    const spaces = await getSubInstanceSpaces();
    const suitable = [];

    // 2. Fetch the actual SubInstance documents from MongoDB to get their URLs
    const activeNodes = await SubInstance.find({ status: 'active' });

    for (const node of activeNodes) {
        const spaceInfo = spaces[node.node_id];
        
        // Check if we have space info for this node and if it has enough room
        if (spaceInfo && spaceInfo.free_space >= fileSize) {
            suitable.push({
                ...node.toObject(), // Includes url, node_id, etc.
                free_space: spaceInfo.free_space,
                total_space: spaceInfo.total_space
            });
        }
    }

    // Sort by most free space available
    return suitable.sort((a, b) => b.free_space - a.free_space);
}

async function uploadFileToSubInstance(subInstance, filePath, fileName, fileHash, title) {
    if (!subInstance || !subInstance.url) {
        console.error("[UPLOAD-NODE] ❌ Error: subInstance or URL is missing");
        return null;
    }

    try {
        const url = `${subInstance.url.replace(/\/$/, '')}/api/upload`;
        const stats = fs.statSync(filePath);
        const fileSizeInBytes = stats.size;

        console.log(`[UPLOAD-NODE] 📤 Streaming to ${subInstance.node_id}`);
        console.log(`[UPLOAD-NODE]    Size: ${(fileSizeInBytes / 1024 / 1024).toFixed(2)} MB`);

        const formData = new FormData();
        const fileStream = fs.createReadStream(filePath);

        // Append the stream
        formData.append('file', fileStream, {
            filename: fileName,
            knownLength: fileSizeInBytes 
        });
        formData.append('hash', fileHash);
        formData.append('title', title || fileName);

        console.log(`[UPLOAD-NODE] ⏳ Sending via native fetch...`);

        // Use native fetch (Node 18+)
        const response = await fetch(url, {
            method: 'POST',
            body: formData,
            // Native fetch automatically sets the correct Content-Type 
            // and manages the stream length without buffering.
            signal: AbortSignal.timeout(600000) // 10 minute timeout
        });

        const result = await response.json();

        if (response.ok) {
            console.log(`[UPLOAD-NODE] ✅ Upload successful to ${subInstance.node_id}`);
            return result;
        }

        // Handle specific error codes (like 409 Conflict)
        if (response.status === 409) {
            console.log(`[UPLOAD-NODE] ⚠️  File already exists on ${subInstance.node_id}.`);
            return {
                isDuplicate: true,
                bucket: result.bucket || 'uploads',
                key: result.key || `uploads/${fileHash}`,
                ...result
            };
        }

        throw new Error(result.error || `Server responded with ${response.status}`);

    } catch (err) {
        // Handle Timeout error specifically
        if (err.name === 'TimeoutError') {
            console.error(`[UPLOAD-NODE] ❌ Upload timed out after 10 minutes`);
        } else {
            console.error(`[UPLOAD-NODE] ❌ Upload failed to ${subInstance.node_id}: ${err.message}`);
        }
        return null;
    }
}
// ============ HEARTBEAT MONITOR ============

async function monitorSubInstanceHealth() {
    console.log('[HEARTBEAT] Starting sub-instance health monitor...');
    console.log('[HEARTBEAT] Checking ALL instances every 10 seconds\n');

    setInterval(async () => {
        try {
            const timestamp = new Date().toLocaleTimeString();
            console.log(`\n[HEARTBEAT] ═══════════════════════════════════════`);
            console.log(`[HEARTBEAT] Health Check at ${timestamp}`);
            console.log(`[HEARTBEAT] ═══════════════════════════════════════`);

            const allInstances = await SubInstance.find();
            const activeInstances = await SubInstance.find({ status: 'active' });

            console.log(`[HEARTBEAT] 📊 Total: ${allInstances.length} | Active: ${activeInstances.length}`);

            if (allInstances.length === 0) {
                console.log(`[HEARTBEAT] ⚠️  No instances registered yet`);
                console.log(`[HEARTBEAT] ═══════════════════════════════════════\n`);
                return;
            }

            let successCount = 0;

            for (const instance of allInstances) {
                const data = await getSubInstanceSpace(instance);
                if (data) {
                    successCount++;
                }
            }

            console.log(`[HEARTBEAT] 📈 Result: ${successCount} healthy, ${allInstances.length - successCount} unreachable`);
            console.log(`[HEARTBEAT] ═══════════════════════════════════════\n`);

        } catch (err) {
            console.error('[HEARTBEAT] ❌ Error:', err.message);
        }
    }, 10000);
}

async function processUploadQueue() {
    setInterval(async () => {
        let tempFilePath = null; // Track path for cleanup
        try {
            const pending = await UploadQueue.findOne({ status: 'pending' }).sort({ created_at: 1 });
            if (!pending) return;

            console.log('\n[QUEUE] ═══════════════════════════════════════');
            console.log(`[QUEUE] Processing: ${pending.filename} (${(pending.size / 1024 / 1024).toFixed(2)} MB)`);

            // 1. Mark as processing
            await UploadQueue.updateOne({ _id: pending._id }, { status: 'processing' });

            // 2. Download from Main R2 to Local Disk
            tempFilePath = await fetchFromMainR2(pending.main_r2_key);
            
            if (!tempFilePath || !fs.existsSync(tempFilePath)) {
                throw new Error("Failed to download file from R2 to local temp storage");
            }

            // 3. Find suitable nodes
            const nodes = await getSuitableNodes(pending.size);
            console.log(`[QUEUE] Found ${nodes.length} suitable nodes for distribution`);

            let uploadedSuccessfully = false;

            for (const node of nodes) {
                // 🚨 Double check node validity to prevent "undefined" logs
                if (!node.url) {
                    console.log(`[QUEUE] ⚠️ Skipping node ${node.node_id} (Missing URL)`);
                    continue;
                }

                // 4. Stream from Disk to Sub-instance
                const result = await uploadFileToSubInstance(
                    node, // This now contains .url and .node_id
                    tempFilePath,
                    pending.filename,
                    pending.hash,
                    pending.title
                );

                if (result) {
                    uploadedSuccessfully = true;
                    // Update File metadata with new location
                    await File.updateOne(
                        { hash: pending.hash },
                        {
                            $push: { 
                                locations: { 
                                    sub_instance: node.node_id, 
                                    bucket: result.bucket || 'uploads', 
                                    key: result.key || `uploads/${pending.hash}` 
                                } 
                            },
                            status: 'distributed'
                        }
                    );
                    console.log(`[QUEUE] ✅ Distributed successfully to ${node.node_id}`);
                    break;
                }
            }

            // 5. Update Queue Status based on success
            await UploadQueue.updateOne(
                { _id: pending._id },
                { 
                    status: uploadedSuccessfully ? 'completed' : 'failed',
                    error_message: uploadedSuccessfully ? null : 'No nodes accepted the file or connection failed'
                }
            );

        } catch (err) {
            console.error('[QUEUE] ❌ Critical Error:', err.message);
            // Revert status to failed if something broke
            await UploadQueue.updateMany({ status: 'processing' }, { status: 'failed', error_message: err.message });
        } finally {
            // 6. ALWAYS CLEAN UP: Move this to 'finally' to ensure it runs even on errors
            if (tempFilePath && fs.existsSync(tempFilePath)) {
                try {
                    fs.unlinkSync(tempFilePath);
                    console.log(`[QUEUE] 🧹 Cleaned up temp file: ${tempFilePath}`);
                } catch (e) {
                    console.error(`[QUEUE] ⚠️ Cleanup failed: ${e.message}`);
                }
            }
            console.log(`[QUEUE] ═══════════════════════════════════════\n`);
        }
    }, 10000);
}
// ============ EXPORTS ============

export {
    initializeR2Client,
    uploadToMainR2,
    fetchFromMainR2,
    deleteFromMainR2,
    getSignedUrlFromSubInstance,
    resetMonthlyLimitIfNeeded,
    checkMonthlyTransferLimit,
    updateMonthlyTransferUsage,
    verifyToken,
    verifyApiToken,
    getActiveSubInstances,
    getSubInstanceSpace,
    getSubInstanceSpaces,
    getSuitableNodes,
    uploadFileToSubInstance,
    monitorSubInstanceHealth,
    processUploadQueue,
    r2Client,
    r2Config
};