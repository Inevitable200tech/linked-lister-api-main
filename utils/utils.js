export const DASHBOARD_HTML = `<!DOCTYPE html>
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
        
        /* File Grid Styles */
        .files-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; margin-top: 20px; }
        .file-card { background: #f9f9f9; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; transition: all 0.3s; }
        .file-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.15); transform: translateY(-2px); }
        .file-card-header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px; }
        .file-card-title { font-weight: 600; word-break: break-word; margin-bottom: 5px; }
        .file-card-subtitle { font-size: 12px; opacity: 0.8; margin-bottom: 8px; }
        .file-card-type { font-size: 12px; opacity: 0.9; }
        .file-card-body { padding: 15px; }
        .file-card-info { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px; font-size: 13px; }
        .file-card-info-item { }
        .file-card-info-label { color: #999; font-size: 11px; text-transform: uppercase; }
        .file-card-info-value { font-weight: 600; color: #333; font-family: monospace; font-size: 11px; }
        .file-card-status { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; margin-bottom: 10px; }
        .file-card-status.pending { background: #fff3cd; color: #856404; }
        .file-card-status.distributed { background: #d4edda; color: #155724; }
        .file-card-location { font-size: 12px; color: #666; margin-bottom: 15px; padding: 10px; background: #f5f5f5; border-radius: 4px; border-left: 3px solid #3498db; }
        .file-card-location-label { font-size: 10px; color: #999; text-transform: uppercase; }
        .file-card-location-value { font-weight: 600; margin-top: 3px; }
        .file-card-actions { display: flex; gap: 8px; }
        .file-card-action-btn { flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 4px; background: white; color: #333; cursor: pointer; font-size: 13px; font-weight: 600; transition: all 0.3s; }
        .file-card-action-btn:hover { background: #3498db; color: white; border-color: #3498db; }
        .file-card-action-btn.download { background: #27ae60; color: white; border-color: #27ae60; }
        .file-card-action-btn.download:hover { background: #229954; border-color: #229954; }
        .file-card-action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        
        /* Modal Styles */
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 1000; align-items: center; justify-content: center; }
        .modal.active { display: flex; }
        .modal-content { background: white; border-radius: 8px; width: 90%; max-width: 900px; max-height: 90vh; overflow: auto; position: relative; }
        .modal-header { background: #34495e; color: white; padding: 20px; display: flex; justify-content: space-between; align-items: center; }
        .modal-title { font-size: 18px; font-weight: 600; word-break: break-word; }
        .modal-close { background: none; border: none; color: white; font-size: 24px; cursor: pointer; padding: 0; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; }
        .modal-close:hover { background: rgba(255,255,255,0.1); border-radius: 4px; }
        .modal-body { padding: 20px; }
        .video-container { width: 100%; background: #000; border-radius: 8px; overflow: hidden; margin-bottom: 20px; }
        .video-player { width: 100%; height: auto; display: block; }
        .file-details { background: #f9f9f9; padding: 15px; border-radius: 8px; }
        .detail-row { display: grid; grid-template-columns: 150px 1fr; gap: 20px; margin-bottom: 15px; font-size: 14px; }
        .detail-label { font-weight: 600; color: #34495e; }
        .detail-value { color: #666; word-break: break-all; }
        .detail-value code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-family: monospace; font-size: 12px; }
        
        @media (max-width: 768px) { 
            .stats-grid { grid-template-columns: 2fr; } 
            .form-row { grid-template-columns: 1fr; }
            .files-grid { grid-template-columns: 1fr; }
            .detail-row { grid-template-columns: 1fr; }
        }
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
            <button class="tab-btn" data-tab="api-tokens" onclick="window.switchTab('api-tokens')">🔑 API Tokens</button>
            <button class="tab-btn" data-tab="r2-config" onclick="window.switchTab('r2-config')">Main R2</button>
            <button class="tab-btn" data-tab="nodes" onclick="window.switchTab('nodes')">Sub-Instances</button>
            <button class="tab-btn" data-tab="files" onclick="window.switchTab('files')">📁 Files</button>
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

                <div style="background: #f0f9ff; padding: 15px; border-radius: 8px; border-left: 4px solid #3498db; margin-bottom: 20px;">
                    <div class="form-group">
                        <label for="upload-title">📝 Title (Optional)</label>
                        <input type="text" id="upload-title" placeholder="Give your file a title..." style="margin-bottom: 0;">
                    </div>
                    <div style="font-size: 12px; color: #666; margin-top: 8px;">💡 Add a descriptive title for your file. If not provided, filename will be used.</div>
                </div>
 
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
 
        <div id="api-tokens" class="tab-content">
            <div class="section">
                <h2>🔑 Create API Token</h2>
                <p style="margin-bottom: 20px; color: #666;">Create tokens for external services (scrapers, etc.) to access the public file API with Bearer token authentication.</p>
                
                <div id="token-message"></div>

                <div style="background: #f0f9ff; padding: 15px; border-radius: 8px; border-left: 4px solid #3498db; margin-bottom: 20px;">
                    <h3 style="margin-bottom: 10px; color: #34495e;">📋 Token Details</h3>
                    <form onsubmit="window.createToken(event)">
                        <div class="form-row">
                            <div class="form-group">
                                <label for="token-name">Token Name *</label>
                                <input type="text" id="token-name" placeholder="e.g., Scraper Instance 1" required>
                            </div>
                            <div class="form-group">
                                <label for="token-expires">Expires At (Optional)</label>
                                <input type="datetime-local" id="token-expires">
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="token-description">Description (Optional)</label>
                            <input type="text" id="token-description" placeholder="e.g., Production video scraper">
                        </div>
                        <button type="submit">Create Token</button>
                    </form>
                </div>
            </div>

            <div class="section">
                <h2>📚 Active Tokens</h2>
                <div id="tokens-list">Loading...</div>
            </div>

            <div class="section">
                <h2>💡 How to Use Tokens</h2>
                <div style="background: #f0fdf4; padding: 15px; border-radius: 8px; border-left: 4px solid #27ae60; margin-bottom: 15px;">
                    <h3 style="margin-bottom: 10px; color: #34495e;">List Files</h3>
                    <pre style="background: #f5f5f5; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 12px;">curl http://localhost:3000/api/public/files \\
  -H "Authorization: Bearer YOUR_TOKEN"</pre>
                </div>

                <div style="background: #f0fdf4; padding: 15px; border-radius: 8px; border-left: 4px solid #27ae60; margin-bottom: 15px;">
                    <h3 style="margin-bottom: 10px; color: #34495e;">Get File Details</h3>
                    <pre style="background: #f5f5f5; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 12px;">curl http://localhost:3000/api/public/file/HASH \\
  -H "Authorization: Bearer YOUR_TOKEN"</pre>
                </div>

                <div style="background: #fef9e7; padding: 15px; border-radius: 8px; border-left: 4px solid #f39c12;">
                    <h3 style="margin-bottom: 10px; color: #34495e;">⚠️ Token Security</h3>
                    <ul style="margin-left: 20px; color: #666;">
                        <li>✅ Token is only shown once at creation - save it immediately</li>
                        <li>✅ Store tokens in environment variables (never in code)</li>
                        <li>✅ Revoke tokens immediately if compromised</li>
                        <li>✅ Monitor "Last Used" timestamp for suspicious activity</li>
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
                <h2>📁 Files</h2>
                <div id="files-list" class="files-grid">Loading...</div>
            </div>
        </div>
 
        <div id="queue" class="tab-content">
            <div class="section">
                <h2>Upload Queue</h2>
                <table class="table">
                    <thead><tr><th>Hash</th><th>Filename</th><th>Title</th><th>Size</th><th>Status</th><th>Attempts</th><th>Message</th></tr></thead>
                    <tbody id="queue-list"><tr><td colspan="7">Loading...</td></tr></tbody>
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
            if (tab === 'api-tokens') window.loadTokens();
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
                
                if (!d.success) {
                    document.getElementById('files-list').innerHTML = '<p>Error loading files</p>';
                    return;
                }

                const html = d.files.map(f => {
                    const isVideo = f.filename.match(/\.(mp4|webm|mkv|avi|mov|flv)$/i);
                    const location = f.location || 'Main R2';
                    const statusClass = f.status === 'distributed' ? 'distributed' : 'pending';
                    
                    return \`
                        <div class="file-card">
                            <div class="file-card-header">
                                <div class="file-card-title">\${f.title || f.filename}</div>
                                <div class="file-card-subtitle">\${f.filename}</div>
                                <div class="file-card-type">\${window.formatBytes(f.size)}</div>
                            </div>
                            <div class="file-card-body">
                                <div style="margin-bottom: 10px;">
                                    <span class="file-card-status \${statusClass}">\${f.status.toUpperCase()}</span>
                                </div>
                                <div class="file-card-location">
                                    <div class="file-card-location-label">📍 Location</div>
                                    <div class="file-card-location-value">\${location}</div>
                                </div>
                                <div class="file-card-info">
                                    <div class="file-card-info-item">
                                        <div class="file-card-info-label">Hash</div>
                                        <div class="file-card-info-value">\${f.hash.substring(0, 12)}...</div>
                                    </div>
                                    <div class="file-card-info-item">
                                        <div class="file-card-info-label">Created</div>
                                        <div class="file-card-info-value">\${new Date(f.created_at).toLocaleDateString()}</div>
                                    </div>
                                </div>
                                <div class="file-card-actions">
                                    \${f.status === 'distributed' && isVideo ? \`<button class="file-card-action-btn" onclick="window.viewFile('\${f.hash}')" style="flex: 1; cursor: pointer;">▶️ Play</button>\` : ''}
                                    \${f.status === 'distributed' ? \`<button class="file-card-action-btn download" onclick="window.downloadFile('\${f.hash}', '\${f.filename}')" style="cursor: pointer;">⬇️ Download</button>\` : \`<button class="file-card-action-btn" disabled>Distributing...</button>\`}
                                </div>
                            </div>
                        </div>
                    \`;
                }).join('');
                
                document.getElementById('files-list').innerHTML = html || '<p>No files yet</p>';
            } catch (e) { 
                console.error(e);
                document.getElementById('files-list').innerHTML = '<p>Error loading files</p>';
            }
        };
 
        window.loadQueue = async function() {
            try {
                const res = await window.apiCall('/api/upload-queue');
                const d = await res.json();
                const html = d.queue.map(q => '<tr><td><code>' + q.hash.substring(0, 16) + '...</code></td><td>' + q.filename + '</td><td>' + (q.title || '-') + '</td><td>' + window.formatBytes(q.size) + '</td><td>' + q.status + '</td><td>' + (q.attempts || 0) + '/' + (q.max_attempts || 3) + '</td><td>' + (q.error_message || '-') + '</td></tr>').join('');
                document.getElementById('queue-list').innerHTML = html || '<tr><td colspan="7">Queue empty</td></tr>';
            } catch (e) { console.error(e); }
        };

        // ============ API TOKEN MANAGEMENT ============

        window.loadTokens = async function() {
            try {
                const res = await window.apiCall('/api/dashboard/tokens');
                const d = await res.json();
                
                if (!d.tokens || d.tokens.length === 0) {
                    document.getElementById('tokens-list').innerHTML = '<p>No API tokens created yet. Create one above to get started.</p>';
                    return;
                }

                const html = d.tokens.map(t => {
                    const status = t.status === 'active' ? '🟢 Active' : '🔴 Revoked';
                    const statusColor = t.status === 'active' ? '#27ae60' : '#e74c3c';
                    const expiresAt = t.expires_at ? new Date(t.expires_at).toLocaleDateString() : 'Never';
                    const lastUsed = t.last_used ? new Date(t.last_used).toLocaleString() : 'Never';
                    
                    return \`<div class="card">
                        <h3>\${t.name}</h3>
                        <p><span style="display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; background: \${statusColor}; color: white;">\${status}</span></p>
                        <p><strong>Description:</strong> \${t.description || '(none)'}</p>
                        <p><strong>Token:</strong> <code>\${t.token_preview}</code> 
                            <button class="file-card-action-btn" style="padding: 4px 8px; margin-left: 5px; cursor: pointer;" onclick="window.copyToClipboard('\${t.token_preview}')">📋 Copy</button>
                        </p>
                        <p><strong>Created:</strong> \${new Date(t.created_at).toLocaleString()}</p>
                        <p><strong>Last Used:</strong> \${lastUsed}</p>
                        <p><strong>Expires:</strong> \${expiresAt}</p>
                        \${t.status === 'active' ?  \`<button class="danger" style="margin-top: 10px; cursor: pointer;" onclick="window.revokeToken('\${t.id}', '\${t.name}')">Revoke Token</button>\` : ''}
                    </div > \`;
                }).join('');
                
                document.getElementById('tokens-list').innerHTML = html;
            } catch (e) { 
                console.error(e);
                document.getElementById('tokens-list').innerHTML = '<p>Error loading tokens</p>';
            }
        };

        window.createToken = async function(e) {
            e.preventDefault();
            
            const name = document.getElementById('token-name').value;
            const description = document.getElementById('token-description').value;
            const expiresAtInput = document.getElementById('token-expires').value;
            
            if (!name.trim()) {
                window.showMessage('token-message', 'Token name is required', 'error');
                return;
            }

            // Convert datetime-local to ISO string
            let expiresAt = null;
            if (expiresAtInput) {
                expiresAt = new Date(expiresAtInput).toISOString();
            }

            const data = {
                name: name.trim(),
                description: description.trim(),
                expires_at: expiresAt
            };

            try {
                const res = await window.apiCall('/api/dashboard/tokens', { 
                    method: 'POST', 
                    body: JSON.stringify(data) 
                });
                const result = await res.json();

                if (!res.ok) {
                    window.showMessage('token-message', result.error || 'Error creating token', 'error');
                    return;
                }

                // Show token with copy button
                const tokenValue = result.token.token;
                const tokenHtml = \`
    < div style = "background: #d4edda; padding: 20px; border-radius: 8px; border: 1px solid #c3e6cb;" >
                        <h3 style="color: #155724; margin-bottom: 15px;">✅ Token Created Successfully!</h3>
                        <p style="color: #155724; margin-bottom: 10px;"><strong>⚠️ Save this token now - it will not be shown again!</strong></p>
                        <div style="background: white; padding: 15px; border-radius: 4px; border: 1px solid #bbb; margin-bottom: 15px; word-break: break-all; font-family: monospace; font-size: 12px;">
                            \${tokenValue}
                        </div>
                        <button class="file-card-action-btn" style="cursor: pointer; padding: 10px 20px; background: #27ae60; border-color: #27ae60; color: white; width: auto;" onclick="window.copyTokenValue('\${tokenValue}')">📋 Copy Token</button>
                        <p style="color: #155724; margin-top: 10px; font-size: 12px;">Use this in your external service with: Authorization: Bearer \${tokenValue.substring(0, 8)}...</p>
                    </div >
\`;
                
                document.getElementById('token-message').innerHTML = tokenHtml;

                // Reset form
                document.getElementById('token-name').value = '';
                document.getElementById('token-description').value = '';
                document.getElementById('token-expires').value = '';

                // Reload tokens list after 1 second
                setTimeout(() => window.loadTokens(), 1000);
            } catch (err) {
                window.showMessage('token-message', 'Error: ' + err.message, 'error');
            }
        };

        window.revokeToken = async function(tokenId, tokenName) {
            if (!confirm(\`Revoke token "\${tokenName}" ? This action cannot be undone.\`)) return;

            try {
                const res = await window.apiCall('/api/dashboard/tokens/' + tokenId, { method: 'DELETE' });
                const d = await res.json();

                if (!res.ok) {
                    window.showMessage('token-message', d.error || 'Error revoking token', 'error');
                    return;
                }

                window.showMessage('token-message', d.message || 'Token revoked successfully', 'success');
                setTimeout(() => window.loadTokens(), 1000);
            } catch (err) {
                window.showMessage('token-message', 'Error: ' + err.message, 'error');
            }
        };

        window.copyTokenValue = function(value) {
            navigator.clipboard.writeText(value).then(() => {
                alert('✅ Token copied to clipboard!');
            }).catch(() => {
                alert('❌ Failed to copy token');
            });
        };

        window.copyToClipboard = function(value) {
            navigator.clipboard.writeText(value).then(() => {
                alert('✅ Copied to clipboard!');
            }).catch(() => {
                alert('❌ Failed to copy');
            });
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

        // View File - Video Player Modal
        window.viewFile = async function(hash) {
            try {
                // No auth needed - endpoint is public
                const res = await fetch('/api/file/' + hash);
                const data = await res.json();
                
                if (!data.success) {
                    alert('Error: ' + data.error);
                    return;
                }

                const file = data.file;
                const downloadUrl = data.download?.url;

                if (!downloadUrl) {
                    alert('File not yet distributed to sub-instance.');
                    return;
                }

                const modal = document.createElement('div');
                modal.className = 'modal active';
                modal.id = 'file-modal';
                modal.innerHTML = \`
                    <div class="modal-content">
                        <div class="modal-header">
                            <div class="modal-title">📹 \${file.title || file.filename}</div>
                            <button class="modal-close" onclick="document.getElementById('file-modal').remove()">&times;</button>
                        </div>
                        <div class="modal-body">
                            <div class="video-container">
                                <video class="video-player" controls style="width: 100%; height: auto;">
                                    <source src="\${downloadUrl}" type="video/mp4">
                                    Your browser does not support the video tag.
                                </video>
                            </div>
                            <div class="file-details">
                                <div class="detail-row">
                                    <div class="detail-label">Title:</div>
                                    <div class="detail-value">\${file.title || '-'}</div>
                                </div>
                                <div class="detail-row">
                                    <div class="detail-label">Filename:</div>
                                    <div class="detail-value">\${file.filename}</div>
                                </div>
                                <div class="detail-row">
                                    <div class="detail-label">Hash:</div>
                                    <div class="detail-value"><code>\${file.hash}</code></div>
                                </div>
                                <div class="detail-row">
                                    <div class="detail-label">Size:</div>
                                    <div class="detail-value">\${window.formatBytes(file.size)}</div>
                                </div>
                                <div class="detail-row">
                                    <div class="detail-label">Status:</div>
                                    <div class="detail-value" style="text-transform: capitalize;">\${file.status}</div>
                                </div>
                                <div class="detail-row">
                                    <div class="detail-label">Location:</div>
                                    <div class="detail-value">\${file.sub_instance || '-'}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                \`;

                document.body.appendChild(modal);

                // Close on outside click
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) modal.remove();
                });
            } catch (err) {
                alert('Error: ' + err.message);
            }
        };

        // Download File
        window.downloadFile = async function(hash, filename) {
            try {
                // No auth needed - endpoint is public
                const res = await fetch('/api/file/' + hash);
                const data = await res.json();
                
                if (!data.success) {
                    alert('Error: ' + data.error);
                    return;
                }

                const downloadUrl = data.download?.url;

                if (downloadUrl) {
                    window.open(downloadUrl, '_blank');
                } else {
                    alert('File not yet distributed. Cannot download.');
                }
            } catch (err) {
                alert('Error: ' + err.message);
            }
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
                
                // ← NEW: Add title if provided
                const titleInput = document.getElementById('upload-title');
                if (titleInput && titleInput.value.trim()) {
                    formData.append('title', titleInput.value.trim());
                }
 
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
                        // ← UPDATED: Handle 202 Accepted status
                        if (xhr.status === 202 || xhr.status === 200) {
                            const result = JSON.parse(xhr.responseText);
                            
                            // Handle duplicate
                            if (result.is_duplicate) {
                                progressItem.classList.add('success');
                                progressItem.querySelector('.progress-item-status').textContent = '✅ Duplicate! Already in system.';
                                progressItem.querySelector('.progress-info').innerHTML = '<strong>Title:</strong> ' + (result.title || result.filename) + '<br><strong>Hash:</strong> <code style="font-size: 11px;">' + result.hash.substring(0, 24) + '...</code>';
                            } else {
                                progressItem.classList.add('success');
                                progressItem.querySelector('.progress-item-status').textContent = '✅ Uploaded! Queued for distribution.';
                                progressItem.querySelector('.progress-info').innerHTML = '<strong>Title:</strong> ' + (result.title || result.filename) + '<br><strong>Hash:</strong> <code style="font-size: 11px;">' + result.hash.substring(0, 24) + '...</code><br><strong>Status:</strong> ' + result.status;
                            }
                            
                            // Auto-load queue and files after 1 second
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
            
            // ← NEW: Clear title input after upload
            document.getElementById('upload-title').value = '';
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
</html>` ;


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