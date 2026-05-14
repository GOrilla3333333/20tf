const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema({
    text: String,
    imageUrl: String,
    active: Boolean,
    updated_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('GlobalBanner', bannerSchema);