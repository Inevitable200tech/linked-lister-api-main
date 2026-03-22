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

// ============ UPDATED FILE SCHEMA - WITH TITLE SUPPORT ============
// Files stored in R2, only metadata in MongoDB
// Removed: stored_at, moved_at (space savings ~50%)
// Added: title (for external API queries)
const fileSchema = new mongoose.Schema({
    // Identification (indexed for fast lookup)
    hash: { 
        type: String, 
        required: true, 
        unique: true, 
        index: true 
    },
    
    // File info
    filename: String,
    title: String,                              // ← NEW: Video title
    size: Number,
    
    // Status (indexed for filtering)
    status: { 
        type: String, 
        enum: ['pending_distribution', 'distributed', 'deleted'], 
        default: 'pending_distribution',
        index: true 
    },
    
    // Temporary location: Main R2 bucket
    main_r2_location: {
        bucket: String,           // R2 bucket name (e.g., "test-bucket")
        key: String               // Object path (e.g., "uploads/a1b2c3d4...")
        // Removed: stored_at (space savings)
    },
    
    // Final location: Sub-instance R2 buckets
    locations: [{
        sub_instance: String,     // Node ID (e.g., "node-1")
        bucket: String,           // Sub-instance bucket (e.g., "my-bucket")
        key: String,              // Object path (e.g., "node-1/a1b2c3d4...")
        status: String            // "active" or "inactive"
        // Removed: moved_at (space savings)
    }],
    
    // Single timestamp
    created_at: { 
        type: Date, 
        default: Date.now,
        index: true
    }
}, { 
    minimize: true  // Reduce stored size
});

// ============ UPDATED UPLOAD QUEUE SCHEMA ============
// Added: title (flows through entire workflow)
// TTL: Auto-delete after 7 days
const uploadQueueSchema = new mongoose.Schema({
    hash: String,
    filename: String,
    title: String,                              // ← NEW: Pass title through queue
    size: Number,
    main_r2_key: String,
    attempts: { type: Number, default: 0 },
    max_attempts: { type: Number, default: 3 },
    status: { 
        type: String, 
        enum: ['pending', 'processing', 'completed', 'failed'], 
        default: 'pending' 
    },
    error_message: String,
    created_at: { 
        type: Date, 
        default: Date.now,
        expire: 604800  // ← Auto-delete after 7 days
    }
});

// ============ INDEXES ============
// File indexes
fileSchema.index({ created_at: 1 }, { expireAfterSeconds: 2592000 }); // ← Optional: Auto-delete after 30 days
fileSchema.index({ status: 1 });
fileSchema.index({ hash: 1 }, { unique: true });

// Queue indexes  
uploadQueueSchema.index({ created_at: 1 }, { expireAfterSeconds: 604800 }); // ← Auto-delete after 7 days
uploadQueueSchema.index({ status: 1 });

// ============ MODELS ============
export const MainR2 = mongoose.model('MainR2', mainR2Schema);
export const SubInstance = mongoose.model('SubInstance', subInstanceSchema);
export const File = mongoose.model('File', fileSchema);
export const UploadQueue = mongoose.model('UploadQueue', uploadQueueSchema);