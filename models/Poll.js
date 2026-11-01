const mongoose = require('mongoose');

const pollOptionSchema = new mongoose.Schema({
    id: { type: String, required: true },
    text: { type: String, required: true }
}, { _id: false });

const pollSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    thread_id: { type: String, required: true, index: true },
    question: { type: String, required: true },
    options: [pollOptionSchema],
    multiple_choice: { type: Boolean, default: false },
    allow_change: { type: Boolean, default: true },
    closes_at: { type: Date, default: null },
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Poll', pollSchema);

