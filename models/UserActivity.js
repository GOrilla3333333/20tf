const mongoose = require('mongoose');

const userActivitySchema = new mongoose.Schema({
    actor_key: { type: String, required: true, unique: true },
    username: { type: String, default: null, index: true },
    is_guest: { type: Boolean, default: false },
    location_type: { type: String, default: 'other', index: true },
    location_id: { type: String, default: '', index: true },
    hide_activity: { type: Boolean, default: false },
    updated_at: { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.model('UserActivity', userActivitySchema);

