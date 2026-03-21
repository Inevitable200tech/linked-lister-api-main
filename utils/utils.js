export const  DASHBOARD_HTML = `<!DOCTYPE html>
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
        
        /* Upload styles */
        .upload-zone { border: 2px dashed #3498db; border-radius: 8px; padding: 40px; text-align: center; cursor: pointer; transition: all 0.3s; background: #f8f9fa; }
        .upload-zone:hover { border-color: #2980b9; background: #eef5f9; }
        .upload-zone.dragover { border-color: #e74c3c; background: #fff5f5; }
        .upload-zone.active { border-color: #27ae60; background: #f0fdf4; }
        .upload-zone-text { font-size: 18px; color: #666; margin-bottom: 10px; }
        .upload-zone-hint { font-size: 12px; color: #999; }
        #file-input { display: none; }
        .upload-progress { margin-top: 20px; }
        .progress-item { background: #f9f9f9; border: 1px solid #ddd; border-radius: 8px; padding: 15px; margin-bottom: 15px; }
        .progress-item-header { display: flex; justify-content: space-between; margin-bottom: 10px; }
        .progress-item-name { font-weight: 500; }
        .progress-item-status { font-size: 12px; color: #666; }
        .progress-bar { width: 100%; height: 8px; background: #ddd; border-radius: 4px; overflow: hidden; margin-bottom: 10px; }
        .progress-bar-fill { height: 100%; background: #3498db; width: 0%; transition: width 0.3s; }
        .progress-item.success .progress-bar-fill { background: #27ae60; width: 100%; }
        .progress-item.error .progress-bar-fill { background: #e74c3c; width: 100%; }
        .progress-info { font-size: 12px; color: #666; }
        .upload-result { margin-top: 20px; padding: 15px; border-radius: 8px; }
        .upload-result.success { background: #d4edda; color: #155724; }
        .upload-result.error { background: #f8d7da; color: #721c24; }
        .upload-result-hash { font-family: monospace; font-size: 12px; word-break: break-all; }
        
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
            <button class="tab-btn" data-tab="upload" onclick="window.switchTab('upload')">📤 Upload File</button>
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
 
        <div id="upload" class="tab-content">
            <div class="section">
                <h2>📤 Upload File</h2>
                <p style="margin-bottom: 20px; color: #666;">Upload a video or file to test the distributed storage workflow. Files will be queued for distribution to sub-instances.</p>
                
                <div id="upload-message"></div>
 
                <div class="upload-zone" id="upload-zone" ondrop="window.handleDrop(event)" ondragover="window.handleDragOver(event)" ondragleave="window.handleDragLeave(event)" onclick="document.getElementById('file-input').click()">
                    <div class="upload-zone-text">📁 Drop files here or click to select</div>
                    <div class="upload-zone-hint">Supports video, images, and any file type</div>
                </div>
                <input type="file" id="file-input" onchange="window.handleFileSelect(event)">
 
                <div class="upload-progress" id="upload-progress"></div>
            </div>
 
            <div class="section">
                <h2>How it works</h2>
                <div style="background: #f0f9ff; padding: 15px; border-radius: 8px; border-left: 4px solid #3498db; margin-bottom: 15px;">
                    <h3 style="margin-bottom: 10px; color: #34495e;">📋 Workflow</h3>
                    <ol style="margin-left: 20px; color: #666;">
                        <li><strong>Upload:</strong> File is sent to main system and stored in Main R2 bucket</li>
                        <li><strong>Queued:</strong> File is added to upload queue for distribution</li>
                        <li><strong>Processing:</strong> Queue processor checks for suitable sub-instances</li>
                        <li><strong>Distributed:</strong> File is transferred to a sub-instance with enough space</li>
                        <li><strong>Complete:</strong> File status updated to "distributed"</li>
                    </ol>
                </div>
 
                <div style="background: #fef9e7; padding: 15px; border-radius: 8px; border-left: 4px solid #f39c12; margin-bottom: 15px;">
                    <h3 style="margin-bottom: 10px; color: #34495e;">⚠️ Requirements</h3>
                    <ul style="margin-left: 20px; color: #666;">
                        <li>✅ Main R2 bucket must be configured (Main R2 tab)</li>
                        <li>✅ At least 1 sub-instance must be registered (Sub-Instances tab)</li>
                        <li>✅ Sub-instance must be online and have available space</li>
                    </ul>
                </div>
 
                <div style="background: #f0fdf4; padding: 15px; border-radius: 8px; border-left: 4px solid #27ae60; margin-bottom: 15px;">
                    <h3 style="margin-bottom: 10px; color: #34495e;">💡 Monitoring</h3>
                    <ul style="margin-left: 20px; color: #666;">
                        <li>📊 Check <strong>Upload Queue</strong> tab to see queue progress</li>
                        <li>📁 Check <strong>Files</strong> tab to see final status and location</li>
                        <li>🔍 Watch server logs for detailed [QUEUE] and [SPACE-CHECK] messages</li>
                    </ul>
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
            setTimeout(() => document.getElementById(el).innerHTML = '', 5000);
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
 
        // Upload functionality
        window.handleDragOver = function(e) {
            e.preventDefault();
            document.getElementById('upload-zone').classList.add('dragover');
        };
 
        window.handleDragLeave = function(e) {
            e.preventDefault();
            document.getElementById('upload-zone').classList.remove('dragover');
        };
 
        window.handleDrop = function(e) {
            e.preventDefault();
            document.getElementById('upload-zone').classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) window.handleFiles(files);
        };
 
        window.handleFileSelect = function(e) {
            const files = e.target.files;
            if (files.length > 0) window.handleFiles(files);
        };
 
        window.handleFiles = async function(files) {
            const progressDiv = document.getElementById('upload-progress');
            progressDiv.innerHTML = '';
 
            for (let file of files) {
                const itemId = 'progress-' + Math.random().toString(36).substr(2, 9);
                const progressItem = document.createElement('div');
                progressItem.id = itemId;
                progressItem.className = 'progress-item';
                progressItem.innerHTML = '<div class="progress-item-header"><div class="progress-item-name">' + file.name + '</div><div class="progress-item-status">Uploading...</div></div><div class="progress-bar"><div class="progress-bar-fill"></div></div><div class="progress-info">0% - 0 KB / ' + window.formatBytes(file.size) + '</div>';
                progressDiv.appendChild(progressItem);
 
                const formData = new FormData();
                formData.append('file', file);
 
                try {
                    const xhr = new XMLHttpRequest();
                    
                    xhr.upload.addEventListener('progress', (e) => {
                        if (e.lengthComputable) {
                            const percentComplete = (e.loaded / e.total) * 100;
                            const fill = progressItem.querySelector('.progress-bar-fill');
                            fill.style.width = percentComplete + '%';
                            const info = progressItem.querySelector('.progress-info');
                            info.textContent = Math.round(percentComplete) + '% - ' + window.formatBytes(e.loaded) + ' / ' + window.formatBytes(e.total);
                        }
                    });
 
                    xhr.addEventListener('load', () => {
                        if (xhr.status === 201) {
                            const result = JSON.parse(xhr.responseText);
                            progressItem.classList.add('success');
                            progressItem.querySelector('.progress-item-status').textContent = '✅ Uploaded! Queued for distribution.';
                            progressItem.querySelector('.progress-info').innerHTML = '<strong>Hash:</strong> <code style="font-size: 11px;">' + result.hash.substring(0, 24) + '...</code><br><strong>Status:</strong> ' + result.status;
                            
                            // Auto-load queue after 1 second
                            setTimeout(() => {
                                window.loadQueue();
                                window.loadFiles();
                            }, 1000);
                        } else {
                            progressItem.classList.add('error');
                            const result = JSON.parse(xhr.responseText);
                            progressItem.querySelector('.progress-item-status').textContent = '❌ Error: ' + (result.error || 'Unknown error');
                        }
                    });
 
                    xhr.addEventListener('error', () => {
                        progressItem.classList.add('error');
                        progressItem.querySelector('.progress-item-status').textContent = '❌ Error uploading file';
                    });
 
                    xhr.open('POST', '/api/upload');
                    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
                    xhr.send(formData);
 
                } catch (err) {
                    progressItem.classList.add('error');
                    progressItem.querySelector('.progress-item-status').textContent = '❌ Error: ' + err.message;
                }
            }
        };
 
        document.addEventListener('DOMContentLoaded', function() {
            const tabButtons = document.querySelectorAll('[data-tab]');
            tabButtons.forEach(btn => {
                btn.addEventListener('click', e => window.switchTab(e.target.dataset.tab));
            });
        });
 
        window.loadOverview();
        setInterval(() => {
            window.loadQueue();
            window.loadFiles();
        }, 3000);
    </script>
</body>
</html>`;

export const LOGIN_HTML = `<!DOCTYPE html>
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