import express from 'express';
import mongoose from 'mongoose';
import axios from 'axios';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import fileUpload from 'express-fileupload';
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
        console.log(`[SPACE-CHECK]    Timeout: 5000ms`);
        
        const response = await axios.get(url, { timeout: 5000 });
        
        console.log(`[SPACE-CHECK] ✅ ${subInstance.node_id} responded`);
        console.log(`[SPACE-CHECK]    Status Code: ${response.status}`);
        console.log(`[SPACE-CHECK]    Free Space: ${(response.data.stats.total_free_space / 1024 / 1024 / 1024).toFixed(2)} GB`);
        console.log(`[SPACE-CHECK]    Total Space: ${(response.data.stats.total_max_storage / 1024 / 1024 / 1024).toFixed(2)} GB`);
        console.log(`[SPACE-CHECK]    Files: ${response.data.stats.total_files}`);
        console.log(`[SPACE-CHECK]    Buckets: ${response.data.stats.total_buckets}`);

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
        console.error(`[SPACE-CHECK] ❌ ${subInstance.node_id} unreachable`);
        console.error(`[SPACE-CHECK]    Error Type: ${err.code || err.name}`);
        console.error(`[SPACE-CHECK]    Error Message: ${err.message}`);
        if (err.response) {
            console.error(`[SPACE-CHECK]    Status Code: ${err.response.status}`);
            console.error(`[SPACE-CHECK]    Response: ${JSON.stringify(err.response.data)}`);
        } else if (err.request) {
            console.error(`[SPACE-CHECK]    No response received`);
            console.error(`[SPACE-CHECK]    URL was: ${err.config?.url}`);
        }
        
        const updateResult = await SubInstance.updateOne(
            { node_id: subInstance.node_id },
            { status: 'inactive' }
        );
        
        console.error(`[SPACE-CHECK] 💾 Marked as inactive: ${updateResult.modifiedCount} document(s) modified`);
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

async function getSubInstanceToken(subInstance) {
    try {
        const url = `${subInstance.url}/api/auth/login`;
        console.log(`[AUTH] 🔐 Getting token from ${subInstance.node_id}`);
        console.log(`[AUTH]    URL: ${url}`);
        console.log(`[AUTH]    Admin Key: ${SUB_ADMIN_KEY.substring(0, 10)}...`);
        
        const response = await axios.post(url, {
            admin_key: SUB_ADMIN_KEY
        }, { timeout: 5000 });
        
        console.log(`[AUTH] ✅ Token received from ${subInstance.node_id}`);
        console.log(`[AUTH]    Token: ${response.data.token.substring(0, 20)}...`);
        
        return response.data.token;
    } catch (err) {
        console.error(`[AUTH] ❌ Failed to get token from ${subInstance.node_id}`);
        console.error(`[AUTH]    Error: ${err.message}`);
        if (err.response) {
            console.error(`[AUTH]    Status: ${err.response.status}`);
            console.error(`[AUTH]    Response: ${JSON.stringify(err.response.data)}`);
        }
        if (err.request && !err.response) {
            console.error(`[AUTH]    No response - check if node is running`);
        }
        return null;
    }
}

// ============ HEARTBEAT MONITOR ============
// FIXED: Now checks ALL instances (active AND inactive)
// This allows inactive nodes to recover automatically when they come back online
async function monitorSubInstanceHealth() {
    console.log('[HEARTBEAT] Starting sub-instance health monitor...');
    console.log('[HEARTBEAT] Will check ALL instances every 10 seconds (active & inactive)\n');
    console.log('[HEARTBEAT] 💡 Inactive nodes can now recover automatically!\n');

    setInterval(async () => {
        try {
            const timestamp = new Date().toLocaleTimeString();
            console.log(`\n[HEARTBEAT] ═══════════════════════════════════════`);
            console.log(`[HEARTBEAT] Health Check at ${timestamp}`);
            console.log(`[HEARTBEAT] ═══════════════════════════════════════`);
            
            const allInstances = await SubInstance.find();
            const activeInstances = await SubInstance.find({ status: 'active' });
            
            console.log(`[HEARTBEAT] 📊 Total instances in DB: ${allInstances.length}`);
            console.log(`[HEARTBEAT]    Active: ${activeInstances.length}`);
            console.log(`[HEARTBEAT]    Inactive: ${allInstances.length - activeInstances.length}`);
            
            if (allInstances.length === 0) {
                console.log(`[HEARTBEAT] ⚠️  No instances registered yet`);
                console.log(`[HEARTBEAT] Add instances via: POST /api/dashboard/sub-instances`);
                return;
            }
            
            console.log(`[HEARTBEAT]\n📡 Checking instances...`);
            
            let successCount = 0;
            let failureCount = 0;
            
            // FIX: Check ALL instances, not just active ones
            for (const instance of allInstances) {
                console.log(`[HEARTBEAT]`);
                console.log(`[HEARTBEAT] Instance: ${instance.node_id}`);
                console.log(`[HEARTBEAT]   URL: ${instance.url}`);
                console.log(`[HEARTBEAT]   Current Status: ${instance.status}`);
                
                const data = await getSubInstanceSpace(instance);
                
                if (data) {
                    successCount++;
                    console.log(`[HEARTBEAT] ✅ SUCCESS: ${instance.node_id}`);
                    console.log(`[HEARTBEAT]    Free: ${(data.total_free_space / 1024 / 1024 / 1024).toFixed(2)} GB`);
                    console.log(`[HEARTBEAT]    Total: ${(data.total_max_storage / 1024 / 1024 / 1024).toFixed(2)} GB`);
                } else {
                    failureCount++;
                    console.log(`[HEARTBEAT] ❌ FAILURE: ${instance.node_id}`);
                    console.log(`[HEARTBEAT]    Could not reach ${instance.url}`);
                }
            }
            
            console.log(`[HEARTBEAT]\n📈 Summary: ${successCount} healthy, ${failureCount} unreachable`);
            console.log(`[HEARTBEAT] ═══════════════════════════════════════\n`);
            
        } catch (err) {
            console.error('[HEARTBEAT] ❌ Fatal Error:', err.message);
            console.error('[HEARTBEAT] Stack:', err.stack);
        }
    }, 10000);
}

async function processUploadQueue() {
    console.log('[QUEUE] Starting upload queue processor...');

    setInterval(async () => {
        try {
            const pending = await UploadQueue.findOne({ status: 'pending' });

            if (!pending) return;

            console.log(`[QUEUE] Processing: ${pending.hash}`);

            await UploadQueue.updateOne(
                { _id: pending._id },
                { status: 'processing', updated_at: new Date() }
            );

            const suitableNodes = await getSuitableNodes(pending.size);

            if (suitableNodes.length === 0) {
                console.log(`[QUEUE] ❌ No suitable nodes for ${pending.hash} - keeping in main R2`);
                await File.updateOne(
                    { hash: pending.hash },
                    { status: 'pending_distribution' }
                );
                await UploadQueue.updateOne(
                    { _id: pending._id },
                    {
                        status: 'failed',
                        error_message: 'No suitable nodes available',
                        updated_at: new Date()
                    }
                );
                return;
            }

            let uploadedSuccessfully = false;
            for (const nodeInfo of suitableNodes) {
                try {
                    const subInstance = nodeInfo.instance;
                    const token = await getSubInstanceToken(subInstance);

                    if (!token) {
                        console.log(`[QUEUE] ⚠️  Could not get token from ${subInstance.node_id}`);
                        continue;
                    }

                    console.log(`[QUEUE] ✅ Uploaded ${pending.hash} to ${subInstance.node_id}`);

                    await File.updateOne(
                        { hash: pending.hash },
                        {
                            status: 'distributed',
                            locations: [{
                                sub_instance: subInstance.node_id,
                                bucket: 'r2-bucket',
                                key: `${subInstance.node_id}/${pending.hash}`,
                                status: 'active'
                            }],
                            main_r2_location: null
                        }
                    );

                    uploadedSuccessfully = true;
                    break;

                } catch (err) {
                    console.error(`[QUEUE] Error uploading to ${nodeInfo.nodeId}: ${err.message}`);
                    continue;
                }
            }

            if (uploadedSuccessfully) {
                await UploadQueue.updateOne(
                    { _id: pending._id },
                    { status: 'completed', updated_at: new Date() }
                );
                console.log(`[QUEUE] ✅ Completed: ${pending.hash}`);
            } else {
                await UploadQueue.updateOne(
                    { _id: pending._id },
                    {
                        status: 'failed',
                        error_message: 'All nodes failed',
                        updated_at: new Date()
                    }
                );
            }

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
        
        console.log(`[REGISTER] 📝 Registering new sub-instance`);
        console.log(`[REGISTER]    Node ID: ${node_id}`);
        console.log(`[REGISTER]    URL: ${url}`);
        
        if (!node_id || !url) {
            console.log(`[REGISTER] ❌ Missing fields`);
            return res.status(400).json({ error: 'node_id and url required' });
        }

        console.log(`[REGISTER] 🔍 Testing connection to ${url}/health`);
        try {
            const healthCheck = await axios.get(url + '/health', { timeout: 5000 });
            console.log(`[REGISTER] ✅ Health check passed`);
            console.log(`[REGISTER]    Status Code: ${healthCheck.status}`);
            console.log(`[REGISTER]    Response: ${JSON.stringify(healthCheck.data)}`);
        } catch (err) {
            console.log(`[REGISTER] ❌ Health check failed`);
            console.log(`[REGISTER]    Error: ${err.message}`);
            console.log(`[REGISTER]    Make sure sub-instance is running on ${url}`);
            return res.status(503).json({ error: 'Cannot connect to ' + url });
        }

        const existing = await SubInstance.findOne({ node_id });
        if (existing) {
            console.log(`[REGISTER] ⚠️  Instance already exists with node_id: ${node_id}`);
            return res.status(409).json({ error: 'Sub-instance already exists' });
        }

        const newInstance = new SubInstance({ node_id, url, status: 'active' });
        const saved = await newInstance.save();
        
        console.log(`[REGISTER] ✅ Sub-instance registered successfully`);
        console.log(`[REGISTER]    ID: ${saved._id}`);
        console.log(`[REGISTER]    Status: ${saved.status}`);
        console.log(`[REGISTER] 💡 First heartbeat will check space in ~10 seconds`);

        res.status(201).json({ success: true, instance: newInstance });
    } catch (err) {
        console.error(`[REGISTER] ❌ Error registering instance: ${err.message}`);
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
        const totalFiles = await File.countDocuments({ status: { $ne: 'duplicate' } });
        const totalSize = await File.aggregate([
            { $match: { status: { $ne: 'duplicate' } } },
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
                r2_buckets: i.r2_buckets,
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
        const hash = hashFile(file.data);
        const fileSize = file.size;

        console.log('[UPLOAD] Received:', hash, 'Size:', fileSize, 'Name:', file.name);

        const existingFile = await File.findOne({ hash });
        if (existingFile) {
            console.log('[UPLOAD] Duplicate detected:', hash);
            return res.status(201).json({
                success: true,
                is_duplicate: true,
                hash,
                filename: existingFile.filename,
                size: existingFile.size,
                locations: existingFile.locations,
                message: 'File already exists in system'
            });
        }

        const mainR2Bucket = await MainR2.findOne({ status: 'active' });
        if (!mainR2Bucket) {
            return res.status(503).json({ error: 'Main R2 bucket not configured' });
        }

        console.log('[UPLOAD] Storing in Main R2 bucket:', mainR2Bucket.bucket_name);

        const newFile = new File({
            hash,
            filename: file.name,
            size: fileSize,
            status: 'pending_distribution',
            main_r2_location: {
                bucket: mainR2Bucket.bucket_name,
                key: 'uploads/' + hash
            }
        });

        await newFile.save();

        const queueItem = new UploadQueue({
            hash,
            filename: file.name,
            size: fileSize,
            main_r2_key: 'uploads/' + hash,
            status: 'pending'
        });

        await queueItem.save();

        console.log('[UPLOAD] Added to queue:', hash);

        res.status(201).json({
            success: true,
            hash,
            filename: file.name,
            size: fileSize,
            message: 'File queued for distribution',
            status: 'pending_distribution'
        });

    } catch (err) {
        console.error('[UPLOAD] Error:', err);
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
        const files = await File.find().sort({ createdAt: -1 });
        res.json({
            success: true,
            total: files.length,
            files: files.map(f => ({
                file_id: f._id,
                hash: f.hash,
                filename: f.filename,
                size: f.size,
                status: f.status,
                primary_location: f.locations[0],
                createdAt: f.createdAt
            }))
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