const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const fileUpload = require('express-fileupload');
const FormData = require('form-data');
const path = require('path');
require('dotenv').config({ path: "cert.env" });

const app = express();
app.use(express.json());
app.use(fileUpload({ useTempFiles: false }));

mongoose.connect(process.env.MAIN_MONGODB_URI);

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Auth middleware
function verifyToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

// Block access to public folder and HTML files BEFORE routes
app.use((req, res, next) => {
    if (req.path.startsWith('/public') || req.path.endsWith('.html')) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    next();
});

// Sub-Instance Schema
const subInstanceSchema = new mongoose.Schema({
    node_id: { type: String, required: true, unique: true },
    url: { type: String, required: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'inactive' },
    free_space: { type: Number, default: 0 },
    file_count: { type: Number, default: 0 },
    last_heartbeat: { type: Date, default: null },
    created_at: { type: Date, default: Date.now }
});

// File Schema
const fileSchema = new mongoose.Schema({
    hash: { type: String, required: true, unique: true, index: true },
    filename: String,
    size: Number,
    locations: [{
        sub_instance: String,
        bucket: String,
        key: String,
        status: String
    }],
    backup_locations: [{
        bucket: String,
        key: String,
        status: String
    }],
    is_duplicate: Boolean,
    original_hash: String,
    createdAt: { type: Date, default: Date.now }
});

const SubInstance = mongoose.model('SubInstance', subInstanceSchema);
const File = mongoose.model('File', fileSchema);

function hashFile(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

async function getActiveSubInstances() {
    return await SubInstance.find({ status: 'active' });
}

async function getSubInstanceSpace(subInstance) {
    try {
        const response = await axios.get(`${subInstance.url}/api/space`, { timeout: 5000 });

        await SubInstance.updateOne(
            { node_id: subInstance.node_id },
            {
                free_space: response.data.free_space,
                file_count: response.data.file_count,
                last_heartbeat: new Date(),
                status: 'active'
            }
        );

        return response.data;
    } catch (err) {
        console.error(`[SPACE] ${subInstance.node_id} unreachable`);
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
                free_space: data.free_space,
                file_count: data.file_count,
                instance
            };
        }
    }

    return spaces;
}

function selectBestSubInstance(spaces) {
    let best = null;
    let maxSpace = -1;

    for (const nodeId in spaces) {
        if (spaces[nodeId].free_space > maxSpace) {
            maxSpace = spaces[nodeId].free_space;
            best = spaces[nodeId].instance;
        }
    }
    return best;
}

function selectBackupSubInstance(spaces, excludeId) {
    let best = null;
    let maxSpace = -1;

    for (const nodeId in spaces) {
        if (nodeId === excludeId) continue;
        if (spaces[nodeId].free_space > maxSpace) {
            maxSpace = spaces[nodeId].free_space;
            best = spaces[nodeId].instance;
        }
    }
    return best;
}

// ============ ROUTES ============

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', (req, res) => {
    const token = req.query.token || req.headers['authorization']?.split(' ')[1];

    if (!token) {
        return res.redirect('/');
    }

    try {
        jwt.verify(token, JWT_SECRET);
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } catch (err) {
        return res.redirect('/');
    }
});

app.post('/api/auth/login', (req, res) => {
    const { password } = req.body;

    if (!password) {
        return res.status(400).json({ error: 'Password required' });
    }

    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Invalid password' });
    }

    const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '24h' });

    res.json({
        success: true,
        token,
        message: 'Login successful'
    });
});

app.post('/api/auth/logout', verifyToken, (req, res) => {
    res.json({ success: true, message: 'Logged out' });
});

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

        if (!node_id || !url) {
            return res.status(400).json({ error: 'node_id and url required' });
        }

        try {
            await axios.get(`${url}/health`, { timeout: 5000 });
        } catch (err) {
            return res.status(503).json({ error: `Cannot connect to ${url}` });
        }

        const existing = await SubInstance.findOne({ node_id });
        if (existing) {
            return res.status(409).json({ error: 'Sub-instance already exists' });
        }

        const newInstance = new SubInstance({ node_id, url, status: 'active' });
        await newInstance.save();

        res.status(201).json({ success: true, instance: newInstance });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/dashboard/sub-instances/:node_id', verifyToken, async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'url required' });
        }

        try {
            await axios.get(`${url}/health`, { timeout: 5000 });
        } catch (err) {
            return res.status(503).json({ error: `Cannot connect to ${url}` });
        }

        const updated = await SubInstance.findOneAndUpdate(
            { node_id: req.params.node_id },
            { url },
            { new: true }
        );

        res.json({ success: true, instance: updated });
    } catch (err) {
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
        const totalFiles = await File.countDocuments();
        const totalSize = await File.aggregate([
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
                file_count: i.file_count,
                last_heartbeat: i.last_heartbeat
            }))
        };

        res.json({ success: true, stats });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/upload', async (req, res) => {
    try {
        if (!req.files || !req.files.file) {
            return res.status(400).json({ error: 'No file provided' });
        }

        const file = req.files.file;
        const hash = hashFile(file.data);

        console.log(`[UPLOAD] Hash: ${hash}, Size: ${file.size}, Name: ${file.name}`);

        const existing = await File.findOne({ hash });
        if (existing) {
            console.log(`[UPLOAD] 🔄 Duplicate found: ${hash}`);
            return res.status(201).json({
                success: true,
                is_duplicate: true,
                hash,
                filename: existing.filename,
                size: existing.size,
                locations: existing.locations,
                message: 'File already exists in system'
            });
        }

        const spaces = await getSubInstanceSpaces();
        if (Object.keys(spaces).length === 0) {
            return res.status(503).json({ error: 'No active sub-instances' });
        }

        const primaryNode = selectBestSubInstance(spaces);
        const backupNode = selectBackupSubInstance(spaces, primaryNode.node_id);

        if (!primaryNode || !backupNode) {
            return res.status(503).json({ error: 'Not enough sub-instances available' });
        }

        console.log(`[UPLOAD] 🎯 Primary: ${primaryNode.node_id}, Backup: ${backupNode.node_id}`);

        const formData = new FormData();
        formData.append('file', file.data, file.name);
        formData.append('hash', hash);

        let primaryResponse;
        try {
            primaryResponse = await axios.post(
                `${primaryNode.url}/api/upload`,
                formData,
                {
                    headers: formData.getHeaders(),
                    timeout: 120000,
                    maxBodyLength: Infinity,
                    maxContentLength: Infinity
                }
            );
        } catch (err) {
            console.error(`[UPLOAD] Primary upload failed: ${err.message}`);
            return res.status(502).json({ error: `Primary upload failed: ${err.message}` });
        }

        const { bucket, key } = primaryResponse.data;

        axios.post(`${backupNode.url}/api/replicate`, {
            source_url: primaryResponse.data.download_url,
            hash,
            filename: file.name
        }).catch(err => console.error(`[REPLICATE] Failed: ${err.message}`));

        const newFile = new File({
            hash,
            filename: file.name,
            size: file.size,
            is_duplicate: false,
            locations: [
                {
                    sub_instance: primaryNode.node_id,
                    bucket,
                    key,
                    status: 'active'
                }
            ],
            backup_locations: [
                {
                    bucket: `backup-${backupNode.node_id}`,
                    key,
                    status: 'pending'
                }
            ]
        });

        await newFile.save();

        console.log(`[UPLOAD] ✅ Saved hash: ${hash}`);

        res.status(201).json({
            success: true,
            hash,
            filename: file.name,
            size: file.size,
            is_duplicate: false,
            primary_location: {
                sub_instance: primaryNode.node_id,
                bucket,
                key
            },
            backup_location: backupNode.node_id,
            message: 'File uploaded and replication queued'
        });

    } catch (err) {
        console.error('[UPLOAD] Error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/files', verifyToken, async (req, res) => {
    try {
        const files = await File.find().sort({ createdAt: -1 });

        const filesWithUrls = await Promise.all(
            files.map(async (file) => {
                let signedUrl = null;

                if (file.locations.length > 0) {
                    const loc = file.locations[0];
                    const subInstance = await SubInstance.findOne({ node_id: loc.sub_instance });

                    if (subInstance) {
                        try {
                            const response = await axios.get(`${subInstance.url}/api/signed-url`, {
                                params: { hash: file.hash, key: loc.key },
                                timeout: 5000
                            });
                            signedUrl = response.data.signed_url;
                        } catch (err) {
                            console.error(`[SIGNED-URL] Failed for ${file.hash}`);
                        }
                    }
                }

                return {
                    file_id: file._id,
                    hash: file.hash,
                    filename: file.filename,
                    size: file.size,
                    is_duplicate: file.is_duplicate,
                    primary_location: file.locations[0],
                    backup_location: file.backup_locations[0],
                    signed_url: signedUrl,
                    createdAt: file.createdAt
                };
            })
        );

        res.json({
            success: true,
            total: files.length,
            files: filesWithUrls
        });
    } catch (err) {
        console.error('[GET FILES] Error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/delete', verifyToken, async (req, res) => {
    try {
        const { hash } = req.body;

        if (!hash) {
            return res.status(400).json({ error: 'Hash required' });
        }

        const file = await File.findOne({ hash });
        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        if (file.locations.length > 0) {
            const loc = file.locations[0];
            const subInstance = await SubInstance.findOne({ node_id: loc.sub_instance });

            if (subInstance) {
                try {
                    await axios.post(`${subInstance.url}/api/delete`, {
                        bucket: loc.bucket,
                        key: loc.key,
                        hash
                    });
                    console.log(`[DELETE] Deleted from ${loc.sub_instance}`);
                } catch (err) {
                    console.error(`[DELETE] Failed to delete from primary: ${err.message}`);
                }
            }
        }

        if (file.backup_locations.length > 0) {
            const backup = file.backup_locations[0];
            const backupSubInstance = await SubInstance.findOne({
                node_id: { $ne: file.locations[0]?.sub_instance }
            });

            if (backupSubInstance) {
                try {
                    await axios.post(`${backupSubInstance.url}/api/delete`, {
                        bucket: backup.bucket,
                        key: backup.key,
                        hash
                    });
                    console.log(`[DELETE] Deleted from backup`);
                } catch (err) {
                    console.error(`[DELETE] Failed to delete from backup: ${err.message}`);
                }
            }
        }

        await File.deleteOne({ hash });

        res.json({
            success: true,
            message: 'File deleted',
            hash
        });

    } catch (err) {
        console.error('[DELETE] Error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

const PORT = process.env.MAIN_PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Main System listening on port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
});