const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
    id: String,
    content: String,
    thread_id: String,
    user_id: String,
    fileUrl: String,           // Keep for backward compatibility
    fileUrls: [String],        // New: Support multiple files
    parent_id: { type: String, default: null },
    edited_at: { type: Date, default: null },
    created_at: { type: Date, default: Date.now }
}, { strict: false });

module.exports = mongoose.model('Post', postSchema);