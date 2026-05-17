const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
    id: String,
    content: String,
    thread_id: String,
    user_id: String,
    fileUrl: String,
    parent_id: { type: String, default: null }, // 🔥 ADD THIS
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Post', postSchema);