const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    pfp: String,
    banner: String,
    bio: String,
    title: { type: String, default: "Member" },
    banned: { type: Boolean, default: false },
    banReason: String,
    banType: String,
    tosAccepted: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },
    created_at: { type: Date, default: Date.now }
}, { strict: false });

module.exports = mongoose.model('User', userSchema);