const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
    id: String,
    content: String,
    thread_id: String,
    user_id: String,
    fileUrl: String,           // Keep for backward compatibility
    fileUrls: [String],        // New: Support multiple files
    parent_id: { type: String, default: null },
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Post', postSchema);