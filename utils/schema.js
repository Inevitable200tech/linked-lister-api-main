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

export const MainR2 = mongoose.model('MainR2', mainR2Schema);
export const SubInstance = mongoose.model('SubInstance', subInstanceSchema);
export const File = mongoose.model('File', fileSchema);
export const UploadQueue = mongoose.model('UploadQueue', uploadQueueSchema);
