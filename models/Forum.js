const mongoose = require('mongoose');

const forumSchema = new mongoose.Schema({
    id: String,
    name: String,
    description: String,
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Forum', forumSchema);