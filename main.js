import express from 'express';
import mongoose from 'mongoose';
import axios from 'axios';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import fileUpload from 'express-fileupload';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { MainR2, SubInstance, File, UploadQueue } from './utils/schema.js';
import dotenv from 'dotenv';
import { LOGIN_HTML, DASHBOARD_HTML } from './utils/utils.js';

dotenv.config({ path: "cert.env" });

const app = express();
app.use(express.json());
app.use(fileUpload({ useTempFiles: false }));

mongoose.connect(process.env.MAIN_MONGODB_URI);

const JWT_SECRET = process.env.JWT_SECRET || 'main-secret-key-change-in-production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SUB_ADMIN_KEY = process.env.SUB_ADMIN_KEY || 'admin-secret-key';

console.log(`⚙️  Main System Configuration:`);
console.log(`   JWT_SECRET: ${JWT_SECRET.substring(0, 20)}...`);
console.log(`   SUB_ADMIN_KEY: ${SUB_ADMIN_KEY}\n`);

// ============ R2 CLIENT ============

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

async function uploadToMainR2(fileName, fileBuffer, hash, title) {
    try {
        if (!r2Client || !r2Config) {
            await initializeR2Client();
        }

        if (!r2Client) {
            throw new Error('R2 client not initialized');
        }

        const key = `uploads/${hash}`;

        // Sanitize title for R2 metadata headers
        const sanitizedTitle = (title || fileName)
            .substring(0, 100)
            .replace(/[^a-zA-Z0-9\-_\s]/g, '_')
            .replace(/\s+/g, '_');

        console.log(`[R2-UPLOAD] 📤 Uploading to Main R2`);
        console.log(`[R2-UPLOAD]    Bucket: ${r2Config.bucket_name}`);
        console.log(`[R2-UPLOAD]    Key: ${key}`);
        console.log(`[R2-UPLOAD]    Title: ${sanitizedTitle}`);
        console.log(`[R2-UPLOAD]    Size: ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB`);

        const command = new PutObjectCommand({
            Bucket: r2Config.bucket_name,
            Key: key,
            Body: fileBuffer,
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

async function fetchFromMainR2(hash) {
    try {
        if (!r2Client || !r2Config) {
            await initializeR2Client();
        }

        if (!r2Client) {
            throw new Error('R2 client not initialized');
        }

        const key = `uploads/${hash}`;

        console.log(`[R2-FETCH] 📥 Fetching from Main R2`);
        console.log(`[R2-FETCH]    Bucket: ${r2Config.bucket_name}`);
        console.log(`[R2-FETCH]    Key: ${key}`);

        const command = new GetObjectCommand({
            Bucket: r2Config.bucket_name,
            Key: key
        });

        const response = await r2Client.send(command);
        const fileBuffer = await response.Body.transformToByteArray();

        console.log(`[R2-FETCH] ✅ Fetched successfully`);
        console.log(`[R2-FETCH]    Size: ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB\n`);

        return Buffer.from(fileBuffer);
    } catch (err) {
        console.error(`[R2-FETCH] ❌ Fetch failed: ${err.message}`);
        throw err;
    }
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

async function getSignedUrlFromSubInstance(subInstance, hash) {
    try {
        const url = `${subInstance.url}/api/signed-url?hash=${hash}`;
        console.log(`[SIGNED-URL] 📝 Getting signed URL from ${subInstance.node_id}`);
        console.log(`[SIGNED-URL]    URL: ${url}`);

        const response = await axios.get(url, { timeout: 5000 });

        console.log(`[SIGNED-URL] ✅ Got signed URL from ${subInstance.node_id}`);
        console.log(`[SIGNED-URL]    Expires at: ${new Date(response.data.expires_at).toLocaleString()}`);

        return response.data;
    } catch (err) {
        console.error(`[SIGNED-URL] ❌ Failed to get signed URL: ${err.message}`);
        return null;
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

// ============ UTILITY FUNCTIONS ============

function hashFile(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

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
    const spaces = await getSubInstanceSpaces();
    const suitable = [];

    for (const nodeId in spaces) {
        if (spaces[nodeId].free_space >= fileSize) {
            suitable.push({
                nodeId,
                ...spaces[nodeId]
            });
        }
    }

    return suitable.sort((a, b) => b.free_space - a.free_space);
}

async function uploadFileToSubInstance(subInstance, fileData, fileName, fileHash, title) {
    try {
        const url = `${subInstance.url}/api/upload`;
        console.log(`[UPLOAD-NODE] 📤 Uploading to ${subInstance.node_id}`);
        console.log(`[UPLOAD-NODE]    URL: ${url}`);
        console.log(`[UPLOAD-NODE]    Filename: ${fileName}`);
        console.log(`[UPLOAD-NODE]    Title: ${title || 'Not provided'}`);
        console.log(`[UPLOAD-NODE]    Size: ${(fileData.length / 1024 / 1024).toFixed(2)} MB`);

        const FormData = (await import('form-data')).default;
        const formData = new FormData();
        formData.append('file', fileData, fileName);
        formData.append('hash', fileHash);
        formData.append('title', title || fileName);

        console.log(`[UPLOAD-NODE] ⏳ Sending to node...`);
        
        const response = await axios.post(url, formData, {
            headers: formData.getHeaders(),
            timeout: 30000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        console.log(`[UPLOAD-NODE] ✅ Upload successful to ${subInstance.node_id}`);
        console.log(`[UPLOAD-NODE]    Bucket: ${response.data.bucket}`);
        console.log(`[UPLOAD-NODE]    Key: ${response.data.key}`);

        return response.data;
    } catch (err) {
        console.error(`[UPLOAD-NODE] ❌ Upload failed to ${subInstance.node_id}: ${err.message}`);
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
    console.log('[QUEUE] Starting upload queue processor...');
    console.log('[QUEUE] Distributing files from Main R2 to sub-instances\n');

    setInterval(async () => {
        try {
            const pending = await UploadQueue.findOne({ status: 'pending' });

            if (!pending) return;

            console.log(`\n[QUEUE] ═══════════════════════════════════════`);
            console.log(`[QUEUE] Processing: ${pending.hash}`);
            console.log(`[QUEUE] Title: ${pending.title || 'Not provided'}`);
            console.log(`[QUEUE] ═══════════════════════════════════════`);

            await UploadQueue.updateOne(
                { _id: pending._id },
                { status: 'processing' }
            );

            const suitableNodes = await getSuitableNodes(pending.size);

            if (suitableNodes.length === 0) {
                console.log(`[QUEUE] ❌ No suitable nodes - file stays in Main R2`);
                await UploadQueue.updateOne(
                    { _id: pending._id },
                    {
                        status: 'failed',
                        error_message: 'No suitable nodes available'
                    }
                );
                console.log(`[QUEUE] ═══════════════════════════════════════\n`);
                return;
            }

            let uploadedSuccessfully = false;
            for (const nodeInfo of suitableNodes) {
                try {
                    const subInstance = nodeInfo.instance;
                    
                    console.log(`[QUEUE]\n[QUEUE] Attempting upload to: ${subInstance.node_id}`);
                    
                    // Fetch file from Main R2
                    console.log(`[QUEUE] 📥 Fetching file from Main R2...`);
                    const fileBuffer = await fetchFromMainR2(pending.hash);
                    
                    // Upload to sub-instance
                    const uploadResult = await uploadFileToSubInstance(
                        subInstance,
                        fileBuffer,
                        pending.filename,
                        pending.hash,
                        pending.title
                    );

                    if (!uploadResult) {
                        console.log(`[QUEUE] ⚠️  Upload failed, trying next node...\n`);
                        continue;
                    }

                    console.log(`[QUEUE] ✅ Upload succeeded to ${subInstance.node_id}`);

                    // Update file metadata with new location
                    await File.updateOne(
                        { hash: pending.hash },
                        {
                            status: 'distributed',
                            locations: [{
                                sub_instance: subInstance.node_id,
                                bucket: uploadResult.bucket,
                                key: uploadResult.key,
                                status: 'active'
                            }],
                            main_r2_location: null
                        }
                    );

                    console.log(`[QUEUE] 📊 Metadata updated: distributed to ${subInstance.node_id}`);

                    // Delete from Main R2
                    await deleteFromMainR2(pending.hash);

                    console.log(`[QUEUE] 🎉 File successfully moved from Main R2 to ${subInstance.node_id}`);

                    uploadedSuccessfully = true;
                    break;

                } catch (err) {
                    console.error(`[QUEUE] ❌ Error: ${err.message}`);
                    continue;
                }
            }

            if (uploadedSuccessfully) {
                await UploadQueue.updateOne(
                    { _id: pending._id },
                    { status: 'completed' }
                );
                console.log(`[QUEUE] ✅ Completed: ${pending.hash}`);
            } else {
                await UploadQueue.updateOne(
                    { _id: pending._id },
                    {
                        status: 'failed',
                        error_message: 'All nodes failed'
                    }
                );
                console.log(`[QUEUE] ❌ All nodes failed for: ${pending.hash}`);
            }

            console.log(`[QUEUE] ═══════════════════════════════════════\n`);

        } catch (err) {
            console.error('[QUEUE] Error:', err.message);
        }
    }, 5000);
}

// ============ ROUTES ============

app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(LOGIN_HTML);
});

app.get('/dashboard', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(DASHBOARD_HTML);
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

// ============ AUTH ENDPOINTS ============

app.post('/api/auth/login', (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Invalid password' });

    const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ success: true, token });
});

// ============ MAIN R2 MANAGEMENT ============

app.get('/api/main-r2', verifyToken, async (req, res) => {
    try {
        const buckets = await MainR2.find({ status: 'active' });
        res.json({ success: true, buckets });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/main-r2', verifyToken, async (req, res) => {
    try {
        const { bucket_name, account_id, access_key_id, secret_access_key, endpoint } = req.body;
        if (!bucket_name || !account_id || !access_key_id || !secret_access_key) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const existing = await MainR2.findOne({ bucket_name });
        if (existing) return res.status(409).json({ error: 'Bucket already exists' });

        const newBucket = new MainR2({
            bucket_name,
            account_id,
            access_key_id,
            secret_access_key,
            endpoint: endpoint || 'https://' + account_id + '.r2.cloudflarestorage.com',
            status: 'active'
        });

        await newBucket.save();

        // Reinitialize R2 client with new credentials
        await initializeR2Client();

        res.status(201).json({ success: true, bucket: newBucket });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ SUB-INSTANCE MANAGEMENT ============

app.get('/api/dashboard/sub-instances', verifyToken, async (req, res) => {
    try {
        const instances = await SubInstance.find().sort({ created_at: -1 });
        res.json({ success: true, instances });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/dashboard/sub-instances', verifyToken, async (req, res) => {
    try {
        const { node_id, url } = req.body;
        
        console.log(`[REGISTER] 📝 Registering new sub-instance: ${node_id}`);
        
        if (!node_id || !url) {
            return res.status(400).json({ error: 'node_id and url required' });
        }

        console.log(`[REGISTER] 🔍 Testing connection...`);
        try {
            await axios.get(url + '/health', { timeout: 5000 });
            console.log(`[REGISTER] ✅ Health check passed`);
        } catch (err) {
            console.log(`[REGISTER] ❌ Health check failed`);
            return res.status(503).json({ error: 'Cannot connect to ' + url });
        }

        const existing = await SubInstance.findOne({ node_id });
        if (existing) {
            return res.status(409).json({ error: 'Sub-instance already exists' });
        }

        const newInstance = new SubInstance({ node_id, url, status: 'active' });
        await newInstance.save();
        
        console.log(`[REGISTER] ✅ Sub-instance registered\n`);

        res.status(201).json({ success: true, instance: newInstance });
    } catch (err) {
        console.error(`[REGISTER] ❌ Error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/dashboard/sub-instances/:node_id', verifyToken, async (req, res) => {
    try {
        await SubInstance.deleteOne({ node_id: req.params.node_id });
        res.json({ success: true, message: 'Sub-instance removed' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/dashboard/status', verifyToken, async (req, res) => {
    try {
        const instances = await SubInstance.find();
        const totalFiles = await File.countDocuments({ status: { $ne: 'deleted' } });
        const totalSize = await File.aggregate([
            { $match: { status: { $ne: 'deleted' } } },
            { $group: { _id: null, total: { $sum: '$size' } } }
        ]);

        const stats = {
            total_nodes: instances.length,
            active_nodes: instances.filter(i => i.status === 'active').length,
            total_files: totalFiles,
            total_size: totalSize[0]?.total || 0,
            nodes: instances.map(i => ({
                node_id: i.node_id,
                url: i.url,
                status: i.status,
                free_space: i.free_space,
                total_space: i.total_space,
                file_count: i.file_count,
                last_heartbeat: i.last_heartbeat
            }))
        };

        res.json({ success: true, stats });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ FILE OPERATIONS - ASYNC UPLOAD ============

app.post('/api/upload', async (req, res) => {
    try {
        if (!req.files || !req.files.file) {
            return res.status(400).json({ error: 'No file provided' });
        }

        const file = req.files.file;
        const { title } = req.body;
        const hash = hashFile(file.data);
        const fileSize = file.size;

        console.log('\n[UPLOAD] ═══════════════════════════════════════');
        console.log('[UPLOAD] 📤 File received');
        console.log('[UPLOAD]    Hash: ' + hash);
        console.log('[UPLOAD]    Filename: ' + file.name);
        console.log('[UPLOAD]    Title: ' + (title || 'Not provided'));
        console.log('[UPLOAD]    Size: ' + (fileSize / 1024 / 1024).toFixed(2) + ' MB');

        const existingFile = await File.findOne({ hash });
        if (existingFile) {
            console.log('[UPLOAD] ⚠️  Duplicate detected');
            console.log('[UPLOAD] ═══════════════════════════════════════\n');
            return res.status(200).json({
                success: true,
                is_duplicate: true,
                hash,
                filename: existingFile.filename,
                title: existingFile.title,
                size: existingFile.size,
                locations: existingFile.locations,
                message: 'File already exists in system'
            });
        }

        const mainR2Bucket = await MainR2.findOne({ status: 'active' });
        if (!mainR2Bucket) {
            console.log('[UPLOAD] ❌ No R2 bucket configured');
            console.log('[UPLOAD] ═══════════════════════════════════════\n');
            return res.status(503).json({ error: 'Main R2 bucket not configured' });
        }

        // Upload to Main R2
        const r2Result = await uploadToMainR2(file.name, file.data, hash, title);

        // Save metadata only to MongoDB (NO file data!)
        console.log('[UPLOAD] 💾 Saving metadata to MongoDB');
        const newFile = new File({
            hash,
            filename: file.name,
            title: title || file.name,
            size: fileSize,
            status: 'pending_distribution',
            main_r2_location: {
                bucket: r2Result.bucket,
                key: r2Result.key
            }
        });

        await newFile.save();
        console.log('[UPLOAD] ✅ Metadata saved to MongoDB');

        const queueItem = new UploadQueue({
            hash,
            filename: file.name,
            title: title || file.name,
            size: fileSize,
            main_r2_key: r2Result.key,
            status: 'pending'
        });

        await queueItem.save();
        console.log('[UPLOAD] 📋 Added to queue');
        console.log('[UPLOAD] ═══════════════════════════════════════\n');

        res.status(202).json({
            success: true,
            hash,
            filename: file.name,
            title: title || file.name,
            size: fileSize,
            message: 'File queued for distribution',
            status: 'pending_distribution',
            pollUrl: `/api/file/${hash}`
        });

    } catch (err) {
        console.error('[UPLOAD] ❌ Error: ' + err.message);
        console.log('[UPLOAD] ═══════════════════════════════════════\n');
        res.status(500).json({ error: err.message });
    }
});

// ============ QUEUE ENDPOINTS ============

app.get('/api/upload-queue', verifyToken, async (req, res) => {
    try {
        const queue = await UploadQueue.find().sort({ created_at: -1 });
        res.json({ success: true, queue });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ FILE OPERATIONS ============

app.get('/api/files', verifyToken, async (req, res) => {
    try {
        const files = await File.find().sort({ created_at: -1 });
        res.json({
            success: true,
            total: files.length,
            files: files.map(f => ({
                hash: f.hash,
                filename: f.filename,
                title: f.title,
                size: f.size,
                status: f.status,
                location: f.locations[0]?.sub_instance || 'Main R2',
                created_at: f.created_at
            }))
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ FILE STREAMING - GET FILE DETAILS WITH SIGNED URL ============

app.get('/api/file/:hash', async (req, res) => {
    try {
        const { hash } = req.params;

        const fileDoc = await File.findOne({ hash });
        if (!fileDoc) {
            return res.status(404).json({ 
                success: false,
                error: 'File not found' 
            });
        }

        // File still being processed
        if (!fileDoc.locations.length) {
            return res.status(202).json({
                success: false,
                error: 'File still being distributed',
                hash: fileDoc.hash,
                filename: fileDoc.filename,
                title: fileDoc.title,
                status: fileDoc.status
            });
        }

        // File distributed to sub-instance
        const location = fileDoc.locations[0];
        const subInstance = await SubInstance.findOne({ node_id: location.sub_instance });

        if (!subInstance) {
            return res.status(503).json({ 
                success: false,
                error: 'Storage node unavailable' 
            });
        }

        // Get signed URL from sub-instance
        const signedUrlData = await getSignedUrlFromSubInstance(subInstance, hash);

        if (!signedUrlData) {
            return res.status(500).json({ 
                success: false,
                error: 'Could not get signed URL' 
            });
        }

        // Perfect for external APIs
        return res.json({
            success: true,
            file: {
                hash: fileDoc.hash,
                filename: fileDoc.filename,
                title: fileDoc.title,
                size: fileDoc.size,
                status: fileDoc.status,
                location: 'sub_instance',
                sub_instance: location.sub_instance,
                bucket: location.bucket,
                key: location.key
            },
            download: {
                url: signedUrlData.signed_url,
                expiresAt: signedUrlData.expires_at
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


const PORT = process.env.MAIN_PORT || 3000;
app.listen(PORT, () => {
    console.log('\n🚀 Main System listening on port ' + PORT);
    console.log('📊 Dashboard: http://localhost:' + PORT);
    console.log('🔑 Login: http://localhost:' + PORT + '/\n');

    // Start both monitors
    monitorSubInstanceHealth();
    processUploadQueue();
});

export { app };