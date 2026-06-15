const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema({
    id: String,
    content: String,
    author: String,
    created_at: Date
});

module.exports = mongoose.model('Announcement', announcementSchema);