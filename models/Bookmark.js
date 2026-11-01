const mongoose = require('mongoose');

const bookmarkSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    user_id: { type: String, required: true, index: true },
    post_id: { type: String, required: true, index: true },
    thread_id: { type: String, required: true, index: true },
    note: { type: String, default: "" },
    created_at: { type: Date, default: Date.now }
});

bookmarkSchema.index({ user_id: 1, post_id: 1 }, { unique: true });

module.exports = mongoose.model('Bookmark', bookmarkSchema);

