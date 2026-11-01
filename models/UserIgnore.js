const mongoose = require('mongoose');

const userIgnoreSchema = new mongoose.Schema({
    user_id: { type: String, required: true, index: true },
    ignored_user_id: { type: String, required: true, index: true },
    created_at: { type: Date, default: Date.now }
});

userIgnoreSchema.index({ user_id: 1, ignored_user_id: 1 }, { unique: true });

module.exports = mongoose.model('UserIgnore', userIgnoreSchema);

