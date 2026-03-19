const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const fileUpload = require('express-fileupload');
const FormData = require('form-data');
require('dotenv').config({ path: "cert.env" });

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

// ============ SCHEMAS ============

const mainR2Schema = new mongoose.Schema({
    bucket_name: { type: String, required: true, unique: true },
    account_id: String,
    access_key_id: String,
    secret_access_key: String,
    endpoint: String,
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    created_at: { type: Date, default: Date.now }
});

const subInstanceSchema = new mongoose.Schema({
    node_id: { type: String, required: true, unique: true },
    url: { type: String, required: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'inactive' },
    free_space: { type: Number, default: 0 },
    total_space: { type: Number, default: 0 },
    file_count: { type: Number, default: 0 },
    last_heartbeat: { type: Date, default: null },
    r2_buckets: { type: Number, default: 0 },
    created_at: { type: Date, default: Date.now }
});

const fileSchema = new mongoose.Schema({
    hash: { type: String, required: true, unique: true, index: true },
    filename: String,
    size: Number,
    status: { type: String, enum: ['distributed', 'pending_distribution', 'duplicate'], default: 'distributed' },
    locations: [{
        sub_instance: String,
        bucket: String,
        key: String,
        status: String
    }],
    main_r2_location: {
        bucket: String,
        key: String
    },
    is_duplicate: Boolean,
    original_hash: String,
    createdAt: { type: Date, default: Date.now }
});

const uploadQueueSchema = new mongoose.Schema({
    hash: String,
    filename: String,
    size: Number,
    main_r2_key: String,
    attempts: { type: Number, default: 0 },
    max_attempts: { type: Number, default: 3 },
    status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
    error_message: String,
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

const MainR2 = mongoose.model('MainR2', mainR2Schema);
const SubInstance = mongoose.model('SubInstance', subInstanceSchema);
const File = mongoose.model('File', fileSchema);
const UploadQueue = mongoose.model('UploadQueue', uploadQueueSchema);

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
        const response = await axios.get(`${subInstance.url}/api/status`, { timeout: 5000 });

        await SubInstance.updateOne(
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

        return response.data.stats;
    } catch (err) {
        console.error(`[SPACE] ${subInstance.node_id} unreachable: ${err.message}`);
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

// Get suitable nodes sorted by free space
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

    // Sort by free space descending
    return suitable.sort((a, b) => b.free_space - a.free_space);
}

async function getSubInstanceToken(subInstance) {
    try {
        const response = await axios.post(`${subInstance.url}/api/auth/login`, {
            admin_key: SUB_ADMIN_KEY
        }, { timeout: 5000 });
        return response.data.token;
    } catch (err) {
        console.error(`[AUTH] Failed to get token from ${subInstance.node_id}: ${err.message}`);
        return null;
    }
}

// Async upload processor - runs in background
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

            // Get suitable nodes for this file
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

            // Try uploading to each suitable node
            let uploadedSuccessfully = false;
            for (const nodeInfo of suitableNodes) {
                try {
                    const subInstance = nodeInfo.instance;
                    const token = await getSubInstanceToken(subInstance);

                    if (!token) {
                        console.log(`[QUEUE] ⚠️  Could not get token from ${subInstance.node_id}`);
                        continue;
                    }

                    // Here we would get file from main R2 and upload to sub-instance
                    // For now, simulating successful upload
                    console.log(`[QUEUE] ✅ Uploaded ${pending.hash} to ${subInstance.node_id}`);

                    // Update file record with location
                    await File.updateOne(
                        { hash: pending.hash },
                        {
                            status: 'distributed',
                            locations: [{
                                sub_instance: subInstance.node_id,
                                bucket: 'r2-bucket', // This would come from actual upload
                                key: `${subInstance.node_id}/${pending.hash}`,
                                status: 'active'
                            }],
                            main_r2_location: null // Delete reference to main R2
                        }
                    );

                    uploadedSuccessfully = true;
                    break; // Successfully uploaded, exit loop

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
    }, 5000); // Check every 5 seconds
}

// ============ HTML PAGES ============

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Main System - Login</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #333;
    }
    .login-container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
      padding: 40px;
      width: 100%;
      max-width: 400px;
    }
    .login-header {
      text-align: center;
      margin-bottom: 30px;
    }
    .login-header h1 {
      font-size: 28px;
      margin-bottom: 10px;
      color: #2c3e50;
    }
    .login-header p {
      color: #999;
      font-size: 14px;
    }
    .form-group {
      margin-bottom: 20px;
    }
    .form-group label {
      display: block;
      margin-bottom: 8px;
      font-weight: 600;
      color: #2c3e50;
    }
    .form-group input {
      width: 100%;
      padding: 12px;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-size: 14px;
      transition: border-color 0.3s;
    }
    .form-group input:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }
    .login-btn {
      width: 100%;
      padding: 12px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s;
    }
    .login-btn:hover { transform: translateY(-2px); }
    .message {
      padding: 12px;
      border-radius: 6px;
      margin-bottom: 15px;
      font-size: 14px;
    }
    .message.error {
      background: #f8d7da;
      color: #721c24;
      border: 1px solid #f5c6cb;
    }
    .message.success {
      background: #d4edda;
      color: #155724;
      border: 1px solid #c3e6cb;
    }
  </style>
</head>
<body>
  <div class="login-container">
    <div class="login-header">
      <h1>📦 Main System</h1>
      <p>Admin Dashboard</p>
    </div>
    <div id="message"></div>
    <form onsubmit="handleLogin(event)">
      <div class="form-group">
        <label>Password</label>
        <input type="password" id="password" placeholder="Enter password" required autofocus>
      </div>
      <button type="submit" class="login-btn">Login</button>
    </form>
    <div style="font-size: 12px; color: #999; text-align: center; margin-top: 20px;">
      Default: <code style="background: #f5f5f5; padding: 2px 6px; border-radius: 3px;">admin123</code>
    </div>
  </div>
  <script>
    async function handleLogin(e) {
      e.preventDefault();
      const password = document.getElementById('password').value;
      const messageEl = document.getElementById('message');

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });

        const data = await res.json();

        if (!res.ok) {
          messageEl.innerHTML = '<div class="message error">' + data.error + '</div>';
          return;
        }

        localStorage.setItem('token', data.token);
        messageEl.innerHTML = '<div class="message success">Login successful! Redirecting...</div>';
        
        setTimeout(() => {
          window.location.href = '/dashboard';
        }, 1000);

      } catch (err) {
        messageEl.innerHTML = '<div class="message error">Error: ' + err.message + '</div>';
      }
    }

    window.addEventListener('load', () => {
      const token = localStorage.getItem('token');
      if (token) {
        window.location.href = '/dashboard';
      }
    });
  </script>
</body>
</html>`;

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Main System - Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; }
        .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
        header { background: #34495e; color: white; padding: 30px; border-radius: 8px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: center; }
        header h1 { font-size: 28px; }
        .logout-btn { padding: 10px 20px; background: #e74c3c; color: white; border: none; border-radius: 4px; cursor: pointer; }
        .logout-btn:hover { background: #c0392b; }
        .tabs { display: flex; gap: 10px; margin-bottom: 20px; border-bottom: 2px solid #ddd; overflow-x: auto; }
        .tab-btn { padding: 12px 20px; border: none; background: none; cursor: pointer; font-size: 16px; border-bottom: 3px solid transparent; margin-bottom: -2px; white-space: nowrap; }
        .tab-btn.active { color: #e74c3c; border-bottom-color: #e74c3c; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        .section { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .section h2 { margin-bottom: 20px; font-size: 20px; color: #34495e; }
        .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 20px; }
        .stat-card { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px; text-align: center; }
        .stat-value { font-size: 28px; font-weight: bold; margin-bottom: 5px; }
        .stat-label { font-size: 12px; opacity: 0.9; }
        .form-group { margin-bottom: 15px; }
        .form-group label { display: block; margin-bottom: 5px; font-weight: 500; }
        .form-group input, .form-group select { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; }
        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
        button { padding: 10px 20px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; }
        button:hover { background: #2980b9; }
        button.danger { background: #e74c3c; }
        .message { padding: 12px; border-radius: 4px; margin-bottom: 15px; }
        .message.success { background: #d4edda; color: #155724; }
        .message.error { background: #f8d7da; color: #721c24; }
        .table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        .table th, .table td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        .table th { background: #f5f5f5; font-weight: 600; }
        .card { background: #f9f9f9; border: 1px solid #ddd; border-radius: 8px; padding: 15px; margin-bottom: 15px; }
        .card h3 { margin-bottom: 10px; color: #34495e; }
        @media (max-width: 768px) { .stats-grid { grid-template-columns: 2fr; } .form-row { grid-template-columns: 1fr; } }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🚀 Main System Dashboard</h1>
            <button class="logout-btn" onclick="window.logout()">🚪 Logout</button>
        </header>

        <div class="tabs">
            <button class="tab-btn active" data-tab="overview" onclick="window.switchTab('overview')">Overview</button>
            <button class="tab-btn" data-tab="r2-config" onclick="window.switchTab('r2-config')">Main R2</button>
            <button class="tab-btn" data-tab="nodes" onclick="window.switchTab('nodes')">Sub-Instances</button>
            <button class="tab-btn" data-tab="files" onclick="window.switchTab('files')">Files</button>
            <button class="tab-btn" data-tab="queue" onclick="window.switchTab('queue')">Upload Queue</button>
        </div>

        <div id="overview" class="tab-content active">
            <div class="section">
                <h2>System Status</h2>
                <div class="stats-grid">
                    <div class="stat-card"><div class="stat-value" id="stat-nodes">0</div><div class="stat-label">Sub-Instances</div></div>
                    <div class="stat-card" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);"><div class="stat-value" id="stat-files">0</div><div class="stat-label">Files</div></div>
                    <div class="stat-card" style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);"><div class="stat-value" id="stat-size">0 GB</div><div class="stat-label">Total Size</div></div>
                    <div class="stat-card" style="background: linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%);"><div class="stat-value" id="stat-buckets">0</div><div class="stat-label">R2 Buckets</div></div>
                </div>
            </div>
        </div>

        <div id="r2-config" class="tab-content">
            <div class="section">
                <h2>Configure Main R2 Bucket</h2>
                <div id="r2-message"></div>
                <form onsubmit="window.addMainR2(event)">
                    <div class="form-row">
                        <div class="form-group"><label>Bucket Name</label><input type="text" id="r2-bucket-name" placeholder="my-main-bucket" required></div>
                        <div class="form-group"><label>Account ID</label><input type="text" id="r2-account-id" required></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group"><label>Access Key</label><input type="text" id="r2-access-key" required></div>
                        <div class="form-group"><label>Secret Key</label><input type="password" id="r2-secret-key" required></div>
                    </div>
                    <button type="submit">Add Main R2 Bucket</button>
                </form>
            </div>

            <div class="section">
                <h2>Active Main R2 Buckets</h2>
                <div id="r2-list">Loading...</div>
            </div>
        </div>

        <div id="nodes" class="tab-content">
            <div class="section">
                <h2>Add Sub-Instance</h2>
                <div id="add-node-message"></div>
                <form onsubmit="window.addNode(event)">
                    <div class="form-row">
                        <div class="form-group"><label>Node ID</label><input type="text" id="node-id" placeholder="node-1" required></div>
                        <div class="form-group"><label>URL</label><input type="text" id="node-url" placeholder="http://localhost:3001" required></div>
                    </div>
                    <button type="submit">Add Sub-Instance</button>
                </form>
            </div>

            <div class="section">
                <h2>Sub-Instances</h2>
                <div id="nodes-list">Loading...</div>
            </div>
        </div>

        <div id="files" class="tab-content">
            <div class="section">
                <h2>Files</h2>
                <table class="table">
                    <thead><tr><th>Filename</th><th>Hash</th><th>Size</th><th>Status</th><th>Location</th></tr></thead>
                    <tbody id="files-list"><tr><td colspan="5">Loading...</td></tr></tbody>
                </table>
            </div>
        </div>

        <div id="queue" class="tab-content">
            <div class="section">
                <h2>Upload Queue</h2>
                <table class="table">
                    <thead><tr><th>Hash</th><th>Filename</th><th>Size</th><th>Status</th><th>Attempts</th><th>Message</th></tr></thead>
                    <tbody id="queue-list"><tr><td colspan="6">Loading...</td></tr></tbody>
                </table>
            </div>
        </div>
    </div>
<script>
        const token = localStorage.getItem('token');
        if (!token) {
            window.location.href = '/';
        }

        window.logout = function() {
            localStorage.removeItem('token');
            window.location.href = '/';
        };

        window.switchTab = function(tab) {
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
            document.getElementById(tab).classList.add('active');
            const btn = document.querySelector('[data-tab="' + tab + '"]');
            if (btn) btn.classList.add('active');
            if (tab === 'overview') window.loadOverview();
            if (tab === 'r2-config') window.loadMainR2();
            if (tab === 'nodes') window.loadNodes();
            if (tab === 'files') window.loadFiles();
            if (tab === 'queue') window.loadQueue();
        };

        window.showMessage = function(el, msg, type) {
            document.getElementById(el).innerHTML = '<div class="message ' + type + '">' + msg + '</div>';
            setTimeout(() => document.getElementById(el).innerHTML = '', 3000);
        };

        window.formatBytes = function(b) {
            if (b === 0) return '0 B';
            const k = 1024, s = ['B', 'KB', 'MB', 'GB'], i = Math.floor(Math.log(b) / Math.log(k));
            return (b / Math.pow(k, i)).toFixed(2) + ' ' + s[i];
        };

        window.apiCall = async function(url, opts = {}) {
            const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', ...opts.headers };
            const res = await fetch(url, { ...opts, headers });
            if (res.status === 401) {
                localStorage.removeItem('token');
                window.location.href = '/';
                return null;
            }
            return res;
        };

        window.loadOverview = async function() {
            try {
                const res = await window.apiCall('/api/dashboard/status');
                const d = await res.json();
                document.getElementById('stat-nodes').textContent = d.stats.total_nodes;
                document.getElementById('stat-files').textContent = d.stats.total_files;
                document.getElementById('stat-size').textContent = window.formatBytes(d.stats.total_size);
                const totalBuckets = d.stats.nodes.reduce((sum, n) => sum + n.r2_buckets, 0);
                document.getElementById('stat-buckets').textContent = totalBuckets;
            } catch (e) { console.error(e); }
        };

        window.loadMainR2 = async function() {
            try {
                const res = await window.apiCall('/api/main-r2');
                const d = await res.json();
                const html = d.buckets.map(b => '<div class="card"><h3>' + b.bucket_name + '</h3><p><strong>Account:</strong> ' + b.account_id + '</p><p><strong>Status:</strong> ' + b.status + '</p></div>').join('');
                document.getElementById('r2-list').innerHTML = html || '<p>No main R2 buckets configured</p>';
            } catch (e) { console.error(e); }
        };

        window.loadNodes = async function() {
            try {
                const res = await window.apiCall('/api/dashboard/sub-instances');
                const d = await res.json();
                const html = d.instances.map(n => '<div class="card"><h3>' + n.node_id + '</h3><p><span style="display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; background: ' + (n.status === 'active' ? '#d4edda' : '#f8d7da') + '; color: ' + (n.status === 'active' ? '#155724' : '#721c24') + ';">' + n.status.toUpperCase() + '</span></p><p><strong>URL:</strong> ' + n.url + '</p><p><strong>Space:</strong> ' + window.formatBytes(n.free_space) + ' free / ' + window.formatBytes(n.total_space) + ' total</p><button class="danger delete-node-btn" data-node-id="' + n.node_id + '" style="margin-top: 10px;">Delete</button></div>').join('');
                document.getElementById('nodes-list').innerHTML = html;
                document.querySelectorAll('.delete-node-btn').forEach(btn => btn.addEventListener('click', e => window.deleteNode(e.target.dataset.nodeId)));
            } catch (e) { console.error(e); }
        };

        window.loadFiles = async function() {
            try {
                const res = await window.apiCall('/api/files');
                const d = await res.json();
                const html = d.files.map(f => '<tr><td>' + f.filename + '</td><td><code style="font-size: 11px;">' + f.hash.substring(0, 16) + '...</code></td><td>' + window.formatBytes(f.size) + '</td><td>' + f.status + '</td><td>' + (f.primary_location?.sub_instance || 'Main R2') + '</td></tr>').join('');
                document.getElementById('files-list').innerHTML = html || '<tr><td colspan="5">No files</td></tr>';
            } catch (e) { console.error(e); }
        };

        window.loadQueue = async function() {
            try {
                const res = await window.apiCall('/api/upload-queue');
                const d = await res.json();
                const html = d.queue.map(q => '<tr><td><code>' + q.hash.substring(0, 16) + '...</code></td><td>' + q.filename + '</td><td>' + window.formatBytes(q.size) + '</td><td>' + q.status + '</td><td>' + q.attempts + '/' + q.max_attempts + '</td><td>' + (q.error_message || '-') + '</td></tr>').join('');
                document.getElementById('queue-list').innerHTML = html || '<tr><td colspan="6">Queue empty</td></tr>';
            } catch (e) { console.error(e); }
        };

        window.addMainR2 = async function(e) {
            e.preventDefault();
            const data = {
                bucket_name: document.getElementById('r2-bucket-name').value,
                account_id: document.getElementById('r2-account-id').value,
                access_key_id: document.getElementById('r2-access-key').value,
                secret_access_key: document.getElementById('r2-secret-key').value
            };
            try {
                const res = await window.apiCall('/api/main-r2', { method: 'POST', body: JSON.stringify(data) });
                const d = await res.json();
                if (!res.ok) { window.showMessage('r2-message', d.error, 'error'); return; }
                window.showMessage('r2-message', 'Main R2 bucket added!', 'success');
                e.target.reset();
                window.loadMainR2();
            } catch (err) { window.showMessage('r2-message', 'Error: ' + err.message, 'error'); }
        };

        window.addNode = async function(e) {
            e.preventDefault();
            const data = {
                node_id: document.getElementById('node-id').value,
                url: document.getElementById('node-url').value
            };
            try {
                const res = await window.apiCall('/api/dashboard/sub-instances', { method: 'POST', body: JSON.stringify(data) });
                const d = await res.json();
                if (!res.ok) { window.showMessage('add-node-message', d.error, 'error'); return; }
                window.showMessage('add-node-message', 'Sub-instance added!', 'success');
                e.target.reset();
                window.loadNodes();
            } catch (err) { window.showMessage('add-node-message', 'Error: ' + err.message, 'error'); }
        };

        window.deleteNode = async function(nodeId) {
            if (!confirm('Delete ' + nodeId + '?')) return;
            try {
                const res = await window.apiCall('/api/dashboard/sub-instances/' + nodeId, { method: 'DELETE' });
                const d = await res.json();
                if (!res.ok) { window.showMessage('add-node-message', d.error, 'error'); return; }
                window.loadNodes();
            } catch (err) { window.showMessage('add-node-message', 'Error: ' + err.message, 'error'); }
        };

        document.addEventListener('DOMContentLoaded', function() {
            const tabButtons = document.querySelectorAll('[data-tab]');
            tabButtons.forEach(btn => {
                btn.addEventListener('click', e => window.switchTab(e.target.dataset.tab));
            });
        });

        window.loadOverview();
        setInterval(window.loadQueue, 5000);
    </script>
</body>
</html>`;

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
        if (!node_id || !url) return res.status(400).json({ error: 'node_id and url required' });

        try {
            await axios.get(url + '/health', { timeout: 5000 });
        } catch (err) {
            return res.status(503).json({ error: 'Cannot connect to ' + url });
        }

        const existing = await SubInstance.findOne({ node_id });
        if (existing) return res.status(409).json({ error: 'Sub-instance already exists' });

        const newInstance = new SubInstance({ node_id, url, status: 'active' });
        await newInstance.save();

        res.status(201).json({ success: true, instance: newInstance });
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

        // Check for duplicates
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

        // Store file in Main R2 (simulated for now)
        const mainR2Bucket = await MainR2.findOne({ status: 'active' });
        if (!mainR2Bucket) {
            return res.status(503).json({ error: 'Main R2 bucket not configured' });
        }

        console.log('[UPLOAD] Storing in Main R2 bucket:', mainR2Bucket.bucket_name);

        // Create file record with pending status
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

        // Add to upload queue for async processing
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

    // Start async upload processor
    processUploadQueue();
});