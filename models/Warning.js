const mongoose = require('mongoose');

const warningSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    user_id: { type: String, required: true, index: true },
    issued_by: { type: String, required: true },
    post_id: { type: String, default: null },
    thread_id: { type: String, default: null },
    law: { type: String, required: true },
    points: { type: Number, default: 1 },
    reason: { type: String, default: "" },
    expires_at: { type: Date, default: null },
    active: { type: Boolean, default: true },
    created_at: { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.model('Warning', warningSchema);

