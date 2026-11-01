const mongoose = require('mongoose');

const watchedThreadSchema = new mongoose.Schema({
    user_id: { type: String, required: true, index: true },
    thread_id: { type: String, required: true, index: true },
    created_at: { type: Date, default: Date.now }
});

watchedThreadSchema.index({ user_id: 1, thread_id: 1 }, { unique: true });

module.exports = mongoose.model('WatchedThread', watchedThreadSchema);

