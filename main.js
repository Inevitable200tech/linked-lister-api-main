import express from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import fileUpload from 'express-fileupload';
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import dotenv from 'dotenv';
import { MainR2, SubInstance, File, UploadQueue, AuthToken } from './utils/schema.js';
import { LOGIN_HTML, DASHBOARD_HTML } from './utils/utils.js';
import {
    initializeR2Client,
    uploadToMainR2,
    getSignedUrlFromSubInstance,
    verifyToken,
    verifyApiToken,
    monitorSubInstanceHealth,
    processUploadQueue,
    hashLargeFile
} from './utils/modules.js';
import fs from 'fs';
dotenv.config({ path: "cert.env" });

const app = express();
app.use(express.json());
app.use(fileUpload({
    useTempFiles: true,
    tempFileDir: '/tmp/', 
    limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // Set to 2GB to match your MAX_FILE_SIZE logic
    abortOnLimit: true // Don't automatically abort - we'll handle it in the route to provide a custom error message
}));

mongoose.connect(process.env.MAIN_MONGODB_URI);

const JWT_SECRET = process.env.JWT_SECRET || 'main-secret-key-change-in-production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SUB_ADMIN_KEY = process.env.SUB_ADMIN_KEY || 'admin-secret-key';

// ← NEW: Upload and transfer limit constants
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;           // 2GB
const MAX_MONTHLY_TRANSFER = 10 * 1024 * 1024 * 1024;   // 10GB per node per month

console.log(`⚙️  Main System Configuration:`);
console.log(`   JWT_SECRET: ${JWT_SECRET.substring(0, 20)}...`);
console.log(`   SUB_ADMIN_KEY: ${SUB_ADMIN_KEY}\n`);

// Initialize R2 client on startup
initializeR2Client();

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

app.post('/api/upload-queue/retry/:id', verifyToken, async (req, res) => {
    try {
        const queueItem = await UploadQueue.findById(req.params.id);
        if (!queueItem) return res.status(404).json({ error: 'Queue item not found' });

        if (queueItem.status !== 'failed') {
            return res.status(400).json({ error: 'Only failed items can be retried' });
        }

        // Reset to pending
        await UploadQueue.updateOne(
            { _id: queueItem._id },
            { 
                status: 'pending',
                attempts: 0,
                error_message: null 
            }
        );

        console.log(`[RETRY] ✅ Retried failed file: ${queueItem.hash}`);

        res.json({ success: true, message: 'File queued for retry' });
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
            file_size_limit: MAX_FILE_SIZE,
            file_size_limit_gb: MAX_FILE_SIZE / 1024 / 1024 / 1024,
            nodes: instances.map(i => {
                const monthlyTransfer = i.monthly_transfer;
                const used = monthlyTransfer.data_transferred;
                const limit = monthlyTransfer.limit_bytes;
                
                return {
                    node_id: i.node_id,
                    url: i.url,
                    status: i.status,
                    free_space: i.free_space,
                    total_space: i.total_space,
                    file_count: i.file_count,
                    last_heartbeat: i.last_heartbeat,
                    // ← NEW: Monthly transfer stats
                    monthly_transfer: {
                        current_month: monthlyTransfer.current_month,
                        limit_gb: (limit / 1024 / 1024 / 1024).toFixed(2),
                        used_gb: (used / 1024 / 1024 / 1024).toFixed(2),
                        remaining_gb: ((limit - used) / 1024 / 1024 / 1024).toFixed(2),
                        percent_used: ((used / limit) * 100).toFixed(1),
                        reset_date: monthlyTransfer.reset_date
                    }
                };
            })
        };

        res.json({ success: true, stats });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ NEW ENDPOINT: GET NODE TRANSFER STATS ============

app.get('/api/dashboard/node-limits/:nodeId', verifyToken, async (req, res) => {
    try {
        const { nodeId } = req.params;
        
        const node = await SubInstance.findOne({ node_id: nodeId });
        if (!node) {
            return res.status(404).json({ error: 'Node not found' });
        }

        const monthlyTransfer = node.monthly_transfer;
        const currentUsage = monthlyTransfer.data_transferred;
        const limit = monthlyTransfer.limit_bytes;
        const remaining = Math.max(0, limit - currentUsage);
        const percentUsed = (currentUsage / limit * 100).toFixed(1);

        res.json({
            success: true,
            node_id: nodeId,
            monthly_limit: {
                current_month: monthlyTransfer.current_month,
                limit_bytes: limit,
                limit_gb: limit / 1024 / 1024 / 1024,
                data_transferred_bytes: currentUsage,
                data_transferred_gb: (currentUsage / 1024 / 1024 / 1024).toFixed(2),
                remaining_bytes: remaining,
                remaining_gb: (remaining / 1024 / 1024 / 1024).toFixed(2),
                percent_used: parseFloat(percentUsed),
                reset_date: monthlyTransfer.reset_date
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ AUTH TOKEN MANAGEMENT ============
// Endpoints for creating and managing API tokens for external access

// CREATE NEW API TOKEN
app.post('/api/dashboard/tokens', verifyToken, async (req, res) => {
    try {
        const { name, description, expires_at } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Token name is required' });
        }

        // Generate random token (32 bytes = 64 hex chars)
        const tokenValue = crypto.randomBytes(32).toString('hex');

        const newToken = new AuthToken({
            name,
            token: tokenValue,
            description: description || '',
            created_by: 'admin',
            expires_at: expires_at ? new Date(expires_at) : null,
            status: 'active'
        });

        await newToken.save();

        console.log(`[TOKEN] ✅ Created new API token: ${name}`);

        res.status(201).json({
            success: true,
            token: {
                id: newToken._id,
                name: newToken.name,
                token: tokenValue,  // Only shown once at creation
                created_at: newToken.created_at,
                expires_at: newToken.expires_at,
                description: newToken.description
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// LIST ALL API TOKENS
app.get('/api/dashboard/tokens', verifyToken, async (req, res) => {
    try {
        const tokens = await AuthToken.find().sort({ created_at: -1 });

        res.json({
            success: true,
            total: tokens.length,
            tokens: tokens.map(t => ({
                id: t._id,
                name: t.name,
                description: t.description,
                status: t.status,
                created_at: t.created_at,
                last_used: t.last_used,
                expires_at: t.expires_at,
                created_by: t.created_by,
                // Don't return actual token value - only shown at creation
                token_preview: t.token.substring(0, 8) + '...' + t.token.substring(t.token.length - 8)
            }))
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// REVOKE API TOKEN
app.delete('/api/dashboard/tokens/:tokenId', verifyToken, async (req, res) => {
    try {
        const { tokenId } = req.params;

        const token = await AuthToken.findByIdAndUpdate(
            tokenId,
            { status: 'revoked' },
            { new: true }
        );

        if (!token) {
            return res.status(404).json({ error: 'Token not found' });
        }

        console.log(`[TOKEN] 🔓 Revoked token: ${token.name}`);

        res.json({
            success: true,
            message: `Token "${token.name}" has been revoked`,
            token: {
                id: token._id,
                name: token.name,
                status: token.status
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ PUBLIC API ENDPOINTS ============
// These endpoints use API tokens for authentication
// Can be accessed by external systems (scrapers, etc.)

// LIST FILES (PUBLIC - WITH API TOKEN AUTH)
app.get('/api/public/files', verifyApiToken, async (req, res) => {
    try {
        const files = await File.find().sort({ created_at: -1 });

        console.log(`[PUBLIC-API] 📋 Listed ${files.length} files (token: ${req.apiToken.name})`);

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

// GET FILE INFO (PUBLIC - WITH API TOKEN AUTH)
app.get('/api/public/file/:hash', verifyApiToken, async (req, res) => {
    try {
        const { hash } = req.params;

        const fileDoc = await File.findOne({ hash });
        if (!fileDoc) {
            return res.status(404).json({
                success: false,
                error: 'File not found'
            });
        }

        console.log(`[PUBLIC-API] 📄 Fetched file info: ${hash.substring(0, 8)}... (token: ${req.apiToken.name})`);

        // File still being processed
        if (!fileDoc.locations || !fileDoc.locations.length) {
            return res.status(202).json({
                success: false,
                error: 'File still being distributed',
                hash: fileDoc.hash,
                filename: fileDoc.filename,
                title: fileDoc.title
            });
        }

        // File ready for download
        const location = fileDoc.locations[0];
        const subInstance = await SubInstance.findOne({ node_id: location.sub_instance });

        if (!subInstance) {
            return res.status(503).json({
                success: false,
                error: 'Storage node unavailable'
            });
        }

        // Generate signed URL from the sub-instance (FIXED)
        const signedUrlData = await getSignedUrlFromSubInstance(subInstance, hash);

        res.json({
            success: true,
            file: {
                hash: fileDoc.hash,
                filename: fileDoc.filename,
                title: fileDoc.title,
                size: fileDoc.size,
                status: fileDoc.status,
                location: {
                    sub_instance: location.sub_instance,
                    bucket: location.bucket,
                    key: location.key
                },
                created_at: fileDoc.created_at
            },
            download: {
                url: signedUrlData ? signedUrlData.signed_url : null,
                expiresAt: signedUrlData ? signedUrlData.expires_at : null
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ FILE OPERATIONS - ASYNC UPLOAD ============

app.post('/api/upload', async (req, res) => {
    let tempFilePath = null; // Track the temp file so we can delete it later

    try {
        if (!req.files || !req.files.file) {
            return res.status(400).json({ error: 'No file provided' });
        }

        const file = req.files.file;
        tempFilePath = file.tempFilePath; // Store the path to the disk file
        const { title } = req.body;
        const fileSize = file.size;

        // 🚨 Calculate hash safely from disk using the stream helper
        const hash = await hashLargeFile(tempFilePath);

        console.log('\n[UPLOAD] ═══════════════════════════════════════');
        console.log('[UPLOAD] 📤 File received');
        console.log('[UPLOAD]    Hash: ' + hash);
        console.log('[UPLOAD]    Filename: ' + file.name);
        console.log('[UPLOAD]    Title: ' + (title || 'Not provided'));
        console.log('[UPLOAD]    Size: ' + (fileSize / 1024 / 1024).toFixed(2) + ' MB');

        // Check file size limit (1GB max)
        if (fileSize > MAX_FILE_SIZE) {
            console.log(`[UPLOAD] ❌ File exceeds 1GB limit`);
            console.log('[UPLOAD] ═══════════════════════════════════════\n');
            return res.status(413).json({
                error: 'File too large',
                message: `Maximum file size is 1GB. Your file is ${(fileSize / 1024 / 1024 / 1024).toFixed(2)}GB`,
                max_size: MAX_FILE_SIZE,
                your_size: fileSize
            });
        }

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

        // 🚨 Pass tempFilePath instead of file.data to your R2 upload function
        console.log('[UPLOAD] ☁️  Uploading to Main R2...');
        const r2Result = await uploadToMainR2(file.name, tempFilePath, hash, title);

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
    } finally {
        // 🚨 ALWAYS clean up the temp file, whether successful or failed
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
            console.log(`[UPLOAD] 🧹 Cleaned up temporary file from disk`);
        }
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