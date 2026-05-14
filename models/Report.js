const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
    id: String,
    post_id: String,
    reported_by: String,
    reason: String,
    status: { type: String, default: "pending" },
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Report', reportSchema);