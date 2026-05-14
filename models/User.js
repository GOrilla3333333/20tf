const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    created_at: { type: Date, default: Date.now },
    banned: { type: Boolean, default: false },
    banType: String,
    banReason: String
});

module.exports = mongoose.model('User', userSchema);