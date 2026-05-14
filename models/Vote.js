const mongoose = require('mongoose');

const voteSchema = new mongoose.Schema({
    id: String,
    user_id: String,
    target_type: String,   // "thread" or "post"
    target_id: String,
    vote_type: Number,     // 1 or -1
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Vote', voteSchema);