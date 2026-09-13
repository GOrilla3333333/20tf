const mongoose = require('mongoose');

const profileCommentSchema = new mongoose.Schema({
    id: String,
    profile_username: String,
    user_id: String,
    content: String,
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ProfileComment', profileCommentSchema);