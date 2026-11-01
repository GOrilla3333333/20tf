const mongoose = require('mongoose');

const conversationMessageSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    conversation_id: { type: String, required: true, index: true },
    sender: { type: String, required: true },
    content: { type: String, required: true },
    created_at: { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.model('ConversationMessage', conversationMessageSchema);

