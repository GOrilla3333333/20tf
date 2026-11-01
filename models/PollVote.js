const mongoose = require('mongoose');

const pollVoteSchema = new mongoose.Schema({
    poll_id: { type: String, required: true, index: true },
    thread_id: { type: String, required: true, index: true },
    user_id: { type: String, required: true, index: true },
    option_ids: [{ type: String }],
    created_at: { type: Date, default: Date.now }
});

pollVoteSchema.index({ poll_id: 1, user_id: 1 }, { unique: true });

module.exports = mongoose.model('PollVote', pollVoteSchema);

