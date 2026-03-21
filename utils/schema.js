import mongoose from 'mongoose';

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

// ============ UPDATED FILE SCHEMA ============
// IMPORTANT: NO fileData in MongoDB!
// Files are stored in R2, only metadata (paths) are in MongoDB
const fileSchema = new mongoose.Schema({
    hash: { type: String, required: true, unique: true, index: true },
    filename: String,
    size: Number,
    // NOTE: fileData REMOVED! File stored in R2, not MongoDB
    status: { type: String, enum: ['pending_distribution', 'distributed', 'deleted'], default: 'pending_distribution' },
    
    // Temporary location: where file is in Main R2 bucket
    main_r2_location: {
        bucket: String,           // ← R2 bucket name (e.g., "test-bucket")
        key: String,              // ← Object path (e.g., "uploads/a1b2c3d4...")
        stored_at: Date           // ← When file was uploaded to Main R2
    },
    
    // Final location: where file ends up after distribution to nodes
    locations: [{
        sub_instance: String,     // ← Node ID (e.g., "node-1")
        bucket: String,           // ← Sub-instance bucket (e.g., "my-bucket")
        key: String,              // ← Object path on node (e.g., "node-1/a1b2c3d4...")
        status: String,           // ← "active" or "inactive"
        moved_at: Date            // ← When file was moved to this node
    }],
    
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

export const MainR2 = mongoose.model('MainR2', mainR2Schema);
export const SubInstance = mongoose.model('SubInstance', subInstanceSchema);
export const File = mongoose.model('File', fileSchema);
export const UploadQueue = mongoose.model('UploadQueue', uploadQueueSchema);