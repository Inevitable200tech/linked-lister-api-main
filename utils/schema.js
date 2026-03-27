import mongoose from 'mongoose';

// ============ SCHEMAS ============

const authTokenSchema = new mongoose.Schema({
    name: { type: String, required: true },
    token: {
        type: String,
        required: true,
        unique: true
    },
    description: String,
    created_at: { type: Date, default: Date.now },
    last_used: { type: Date, default: null },
    status: {
        type: String,
        enum: ['active', 'revoked'],
        default: 'active'
    },
    created_by: String,
    expires_at: { type: Date, default: null }
});

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

    monthly_transfer: {
        current_month: {
            type: String,
            default: () => new Date().toISOString().slice(0, 7)
        },
        data_transferred: { type: Number, default: 0 },
        limit_bytes: { type: Number, default: 10 * 1024 * 1024 * 1024 },
        reset_date: {
            type: Date,
            default: () => {
                const now = new Date();
                return new Date(now.getFullYear(), now.getMonth() + 1, 1);
            }
        }
    },
    created_at: { type: Date, default: Date.now }
});

// ============ FILE SCHEMA ============
const fileSchema = new mongoose.Schema({
    hash: {
        type: String,
        required: true,
        unique: true
        // ← REMOVED: index: true
    },
    filename: String,
    title: String,
    size: Number,

    status: {
        type: String,
        enum: ['pending_distribution', 'distributed', 'deleted'],
        default: 'pending_distribution'
        // ← REMOVED: index: true
    },

    main_r2_location: {
        bucket: String,
        key: String
    },

    locations: [{
        sub_instance: String,
        bucket: String,
        key: String,
        status: String
    }],

    created_at: {
        type: Date,
        default: Date.now
        // ← REMOVED: index: true
    }
}, {
    minimize: true
});

// ============ UPLOAD QUEUE SCHEMA ============
const uploadQueueSchema = new mongoose.Schema({
    hash: String,
    filename: String,
    title: String,
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
        expireAfterSeconds: 604800   // 7 days
    }
});

// ============ INDEXES ============
// Explicit indexes (this is the recommended way)

fileSchema.index({ status: 1 });
fileSchema.index({ hash: 1 }, { unique: true });   // unique is already there, but ok to reinforce

uploadQueueSchema.index({ created_at: 1 }, { expireAfterSeconds: 604800 });
uploadQueueSchema.index({ status: 1 });

// ============ MODELS ============
export const MainR2 = mongoose.model('MainR2', mainR2Schema);
export const SubInstance = mongoose.model('SubInstance', subInstanceSchema);
export const File = mongoose.model('File', fileSchema);
export const UploadQueue = mongoose.model('UploadQueue', uploadQueueSchema);
export const AuthToken = mongoose.model('AuthToken', authTokenSchema);