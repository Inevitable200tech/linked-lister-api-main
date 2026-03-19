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
const SUB_ADMIN_KEY = process.env.SUB_ADMIN_KEY || 'admin-secret-key'; // For authenticating with sub-instances

console.log(`⚙️  Main System Configuration:`);
console.log(`   JWT_SECRET: ${JWT_SECRET.substring(0, 20)}...`);
console.log(`   SUB_ADMIN_KEY: ${SUB_ADMIN_KEY}\n`);

// ============ SCHEMAS ============

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
    locations: [{
        sub_instance: String,
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

// Get JWT token from sub-instance for authenticated requests
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
    .spinner { display: inline-block; width: 20px; height: 20px; border: 3px solid rgba(255, 255, 255, 0.3); border-top-color: white; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
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
          messageEl.innerHTML = \`<div class="message error">\${data.error}</div>\`;
          return;
        }

        localStorage.setItem('token', data.token);
        messageEl.innerHTML = '<div class="message success">Login successful! Redirecting...</div>';
        
        setTimeout(() => {
          window.location.href = '/dashboard';
        }, 1000);

      } catch (err) {
        messageEl.innerHTML = \`<div class="message error">Error: \${err.message}</div>\`;
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
        .tabs { display: flex; gap: 10px; margin-bottom: 20px; border-bottom: 2px solid #ddd; }
        .tab-btn { padding: 12px 20px; border: none; background: none; cursor: pointer; font-size: 16px; border-bottom: 3px solid transparent; margin-bottom: -2px; }
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
        .node-card { background: #f9f9f9; border: 1px solid #ddd; border-radius: 8px; padding: 15px; margin-bottom: 15px; }
        .node-card h3 { margin-bottom: 10px; color: #34495e; }
        .node-info { font-size: 13px; margin: 5px 0; }
        .node-status { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
        .status-active { background: #d4edda; color: #155724; }
        .status-inactive { background: #f8d7da; color: #721c24; }
        .node-actions { display: flex; gap: 8px; margin-top: 10px; }
        .node-actions button { flex: 1; padding: 8px; font-size: 12px; }
        .message { padding: 12px; border-radius: 4px; margin-bottom: 15px; }
        .message.success { background: #d4edda; color: #155724; }
        .message.error { background: #f8d7da; color: #721c24; }
        .table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        .table th, .table td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        .table th { background: #f5f5f5; font-weight: 600; }
        @media (max-width: 768px) { .stats-grid { grid-template-columns: 2fr; } .form-row { grid-template-columns: 1fr; } }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🚀 Main System Dashboard</h1>
            <button class="logout-btn" onclick="logout()">🚪 Logout</button>
        </header>

        <div class="tabs">
            <button class="tab-btn active" onclick="switchTab('overview')">Overview</button>
            <button class="tab-btn" onclick="switchTab('nodes')">Sub-Instances</button>
            <button class="tab-btn" onclick="switchTab('buckets')">R2 Buckets</button>
            <button class="tab-btn" onclick="switchTab('files')">Files</button>
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

        <div id="nodes" class="tab-content">
            <div class="section">
                <h2>Add Sub-Instance</h2>
                <div id="add-node-message"></div>
                <form onsubmit="addNode(event)">
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

        <div id="buckets" class="tab-content">
            <div class="section">
                <h2>Add R2 Bucket to Sub-Instance</h2>
                <div id="add-bucket-message"></div>
                <form onsubmit="addBucket(event)">
                    <div class="form-row">
                        <div class="form-group">
                            <label>Sub-Instance</label>
                            <select id="bucket-node-id" required>
                                <option value="">Select a node...</option>
                            </select>
                        </div>
                        <div class="form-group"><label>Bucket Name</label><input type="text" id="bucket-name" placeholder="my-bucket" required></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group"><label>Account ID</label><input type="text" id="bucket-account-id" placeholder="Cloudflare Account ID" required></div>
                        <div class="form-group"><label>Access Key</label><input type="text" id="bucket-access-key" required></div>
                    </div>
                    <div class="form-group"><label>Secret Key</label><input type="password" id="bucket-secret-key" required></div>
                    <button type="submit">Add Bucket</button>
                </form>
            </div>

            <div class="section">
                <h2>Buckets by Node</h2>
                <div id="buckets-list">Loading...</div>
            </div>
        </div>

        <div id="files" class="tab-content">
            <div class="section">
                <h2>Files</h2>
                <table class="table">
                    <thead><tr><th>Filename</th><th>Hash</th><th>Size</th><th>Location</th><th>Date</th></tr></thead>
                    <tbody id="files-list"><tr><td colspan="5">Loading...</td></tr></tbody>
                </table>
            </div>
        </div>
    </div>

    <script>
        const token = localStorage.getItem('token');
        if (!token) {
            window.location.href = '/';
        }

        function logout() {
            localStorage.removeItem('token');
            window.location.href = '/';
        }

        function switchTab(tab) {
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
            document.getElementById(tab).classList.add('active');
            event.target.classList.add('active');
            if (tab === 'overview') loadOverview();
            if (tab === 'nodes') loadNodes();
            if (tab === 'buckets') loadBuckets();
            if (tab === 'files') loadFiles();
        }

        function showMessage(el, msg, type) {
            document.getElementById(el).innerHTML = \`<div class="message \${type}">\${msg}</div>\`;
            setTimeout(() => document.getElementById(el).innerHTML = '', 3000);
        }

        function formatBytes(b) {
            if (b === 0) return '0 B';
            const k = 1024, s = ['B', 'KB', 'MB', 'GB'], i = Math.floor(Math.log(b) / Math.log(k));
            return (b / Math.pow(k, i)).toFixed(2) + ' ' + s[i];
        }

        async function apiCall(url, opts = {}) {
            const headers = { 'Authorization': \`Bearer \${token}\`, 'Content-Type': 'application/json', ...opts.headers };
            const res = await fetch(url, { ...opts, headers });
            if (res.status === 401) {
                localStorage.removeItem('token');
                window.location.href = '/';
                return null;
            }
            return res;
        }

        async function loadOverview() {
            try {
                const res = await apiCall('/api/dashboard/status');
                const d = await res.json();
                document.getElementById('stat-nodes').textContent = d.stats.total_nodes;
                document.getElementById('stat-files').textContent = d.stats.total_files;
                document.getElementById('stat-size').textContent = formatBytes(d.stats.total_size);
                const totalBuckets = d.stats.nodes.reduce((sum, n) => sum + n.r2_buckets, 0);
                document.getElementById('stat-buckets').textContent = totalBuckets;
            } catch (e) { console.error(e); }
        }

        async function loadNodes() {
            try {
                const res = await apiCall('/api/dashboard/sub-instances');
                const d = await res.json();
                const html = d.instances.map(n => \`
                    <div class="node-card">
                        <h3>\${n.node_id}</h3>
                        <span class="node-status \${n.status === 'active' ? 'status-active' : 'status-inactive'}">\${n.status.toUpperCase()}</span>
                        <div class="node-info"><strong>URL:</strong> \${n.url}</div>
                        <div class="node-info"><strong>R2 Buckets:</strong> \${n.r2_buckets || 0}</div>
                        <div class="node-info"><strong>Files:</strong> \${n.file_count}</div>
                        <div class="node-info"><strong>Space:</strong> \${formatBytes(n.free_space)} free / \${formatBytes(n.total_space)} total</div>
                        <div class="node-info"><strong>Last Heartbeat:</strong> \${n.last_heartbeat ? new Date(n.last_heartbeat).toLocaleString() : 'Never'}</div>
                        <div class="node-actions">
                            <button onclick="deleteNode('\${n.node_id}')" class="danger">Delete</button>
                        </div>
                    </div>
                \`).join('');
                document.getElementById('nodes-list').innerHTML = html || '<p>No sub-instances</p>';

                // Update bucket node dropdown
                const select = document.getElementById('bucket-node-id');
                const activeNodes = d.instances.filter(n => n.status === 'active');
                select.innerHTML = '<option value="">Select a node...</option>' + activeNodes.map(n => \`<option value="\${n.node_id}">\${n.node_id}</option>\`).join('');
            } catch (e) { console.error(e); }
        }

        async function loadBuckets() {
            await loadNodes(); // Refresh nodes list
            try {
                const res = await apiCall('/api/dashboard/sub-instances');
                const d = await res.json();
                let html = '';
                for (const node of d.instances) {
                    try {
                        const bRes = await fetch(\`\${node.url}/api/buckets\`);
                        const bData = await bRes.json();
                        html += \`<div class="node-card"><h3>📦 \${node.node_id}</h3>\`;
                        if (bData.buckets && bData.buckets.length > 0) {
                            html += bData.buckets.map(b => \`
                                <div style="margin: 10px 0; padding: 10px; background: #f0f0f0; border-radius: 4px;">
                                    <strong>\${b.bucket_name}</strong><br>
                                    <small>Account: \${b.account_id} | Files: \${b.file_count} | Space: \${formatBytes(b.storage_used)}/\${formatBytes(b.max_storage)}</small>
                                </div>
                            \`).join('');
                        } else {
                            html += '<p style="color: #999;">No buckets configured</p>';
                        }
                        html += '</div>';
                    } catch (e) {
                        html += \`<div class="node-card"><h3>\${node.node_id}</h3><p style="color: #999;">Could not load buckets</p></div>\`;
                    }
                }
                document.getElementById('buckets-list').innerHTML = html;
            } catch (e) { console.error(e); }
        }

        async function loadFiles() {
            try {
                const res = await apiCall('/api/files');
                const d = await res.json();
                const html = d.files.map(f => \`
                    <tr>
                        <td>\${f.filename}</td>
                        <td><code style="font-size: 11px;">\${f.hash.substring(0, 16)}...</code></td>
                        <td>\${formatBytes(f.size)}</td>
                        <td>\${f.primary_location?.sub_instance || 'Unknown'}</td>
                        <td>\${new Date(f.createdAt).toLocaleString()}</td>
                    </tr>
                \`).join('');
                document.getElementById('files-list').innerHTML = html || '<tr><td colspan="5">No files</td></tr>';
            } catch (e) { console.error(e); }
        }

        async function addNode(e) {
            e.preventDefault();
            const data = {
                node_id: document.getElementById('node-id').value,
                url: document.getElementById('node-url').value
            };
            try {
                const res = await apiCall('/api/dashboard/sub-instances', { method: 'POST', body: JSON.stringify(data) });
                const d = await res.json();
                if (!res.ok) { showMessage('add-node-message', d.error, 'error'); return; }
                showMessage('add-node-message', 'Sub-instance added!', 'success');
                e.target.reset();
                loadNodes();
            } catch (err) { showMessage('add-node-message', 'Error: ' + err.message, 'error'); }
        }

        async function addBucket(e) {
            e.preventDefault();
            const nodeId = document.getElementById('bucket-node-id').value;
            const data = {
                bucket_name: document.getElementById('bucket-name').value,
                account_id: document.getElementById('bucket-account-id').value,
                access_key_id: document.getElementById('bucket-access-key').value,
                secret_access_key: document.getElementById('bucket-secret-key').value
            };
            try {
                // Get the node
                const nodesRes = await apiCall('/api/dashboard/sub-instances');
                const nodesData = await nodesRes.json();
                const node = nodesData.instances.find(n => n.node_id === nodeId);
                
                if (!node) { showMessage('add-bucket-message', 'Node not found', 'error'); return; }
                
                // Get token from sub-instance
                const loginRes = await fetch(\`\${node.url}/api/auth/login\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ admin_key: 'admin-secret-key' })
                });
                const loginData = await loginRes.json();
                const subToken = loginData.token;
                
                // Add bucket to sub-instance
                const res = await fetch(\`\${node.url}/api/buckets\`, {
                    method: 'POST',
                    headers: { 
                        'Authorization': \`Bearer \${subToken}\`,
                        'Content-Type': 'application/json' 
                    },
                    body: JSON.stringify(data)
                });
                const d = await res.json();
                if (!res.ok) { showMessage('add-bucket-message', d.error, 'error'); return; }
                showMessage('add-bucket-message', 'Bucket added!', 'success');
                e.target.reset();
                loadBuckets();
            } catch (err) { showMessage('add-bucket-message', 'Error: ' + err.message, 'error'); }
        }

        async function deleteNode(nodeId) {
            if (!confirm(\`Delete \${nodeId}?\`)) return;
            try {
                const res = await apiCall(\`/api/dashboard/sub-instances/\${nodeId}\`, { method: 'DELETE' });
                const d = await res.json();
                if (!res.ok) { showMessage('add-node-message', d.error, 'error'); return; }
                loadNodes();
            } catch (err) { showMessage('add-node-message', 'Error: ' + err.message, 'error'); }
        }

        loadOverview();
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

// ============ FILE OPERATIONS ============

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
        if (!primaryNode) {
            return res.status(503).json({ error: 'No suitable sub-instance available' });
        }

        console.log(`[UPLOAD] 🎯 Primary: ${primaryNode.node_id}`);

        // Get token from sub-instance
        const token = await getSubInstanceToken(primaryNode);
        if (!token) {
            return res.status(503).json({ error: 'Failed to authenticate with sub-instance' });
        }

        const formData = new FormData();
        formData.append('file', file.data, file.name);
        formData.append('hash', hash);

        let primaryResponse;
        try {
            primaryResponse = await axios.post(
                `${primaryNode.url}/api/upload`,
                formData,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        ...formData.getHeaders()
                    },
                    timeout: 120000,
                    maxBodyLength: Infinity,
                    maxContentLength: Infinity
                }
            );
        } catch (err) {
            console.error(`[UPLOAD] Primary upload failed: ${err.message}`);
            return res.status(502).json({ error: `Upload failed: ${err.message}` });
        }

        const { bucket, key } = primaryResponse.data;

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
            message: 'File uploaded successfully'
        });

    } catch (err) {
        console.error('[UPLOAD] Error:', err);
        res.status(500).json({ error: err.message });
    }
});

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
                is_duplicate: f.is_duplicate,
                primary_location: f.locations[0],
                createdAt: f.createdAt
            }))
        });
    } catch (err) {
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
                const token = await getSubInstanceToken(subInstance);
                if (token) {
                    try {
                        await axios.post(
                            `${subInstance.url}/api/delete`,
                            { hash },
                            {
                                headers: { 'Authorization': `Bearer ${token}` }
                            }
                        );
                        console.log(`[DELETE] Deleted from ${loc.sub_instance}`);
                    } catch (err) {
                        console.error(`[DELETE] Failed to delete from sub-instance: ${err.message}`);
                    }
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

const PORT = process.env.MAIN_PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Main System listening on port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`🔑 Login: http://localhost:${PORT}/\n`);
});