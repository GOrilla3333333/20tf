const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
    id: String,
    to_user: String,
    from_user: String,
    type: String,
    message: String,
    link: String,
    threadTitle: { type: String, default: "" },
    read: { type: Boolean, default: false },
    created_at: { type: Date, default: Date.now }
}, { strict: false });

module.exports = mongoose.model('Alert', alertSchema);