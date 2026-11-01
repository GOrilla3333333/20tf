const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    creator: { type: String, required: true },
    participants: [{ type: String, index: true }],
    all_participants: [{ type: String }],
    unread_by: [{ type: String }],
    left_by: [{ type: String }],
    last_message_at: { type: Date, default: Date.now, index: true },
    last_message_by: { type: String },
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Conversation', conversationSchema);

