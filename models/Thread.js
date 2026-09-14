const mongoose = require('mongoose');

const threadSchema = new mongoose.Schema({
    id: String,
    title: String,
    forum_id: String,
    user_id: String,
    prefix: { type: String, default: "" },
    pinned: { type: Boolean, default: false },
    views: { type: Number, default: 0 },
    locked: { type: Boolean, default: false },
    viewedBy: { type: [String], default: [] },
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Thread', threadSchema);