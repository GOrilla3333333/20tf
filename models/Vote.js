const mongoose = require('mongoose');

const voteSchema = new mongoose.Schema({
    id: String,
    user_id: String,
    target_type: String,   // "thread" or "post"
    target_id: String,
    vote_type: { type: Number, default: 1 },     // 1 or -1
    reaction: { type: String, default: 'like' }, // like, love, haha, fire, skull
    created_at: { type: Date, default: Date.now }
}, { strict: false });

module.exports = mongoose.model('Vote', voteSchema);