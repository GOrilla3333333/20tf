const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: String,
    password: String,
    banned: { type: Boolean, default: false },
    banReason: String,
    banType: String,
    tosAccepted: { type: Boolean, default: false },
    pfp: { type: String, default: "https://i.imgur.com/oJCfWc8.png" },
    banner: { type: String, default: "" },
    bio: { type: String, default: "No bio yet." },
    created_at: { type: Date, default: Date.now }
}, { strict: false });

module.exports = mongoose.model('User', userSchema);