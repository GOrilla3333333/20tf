const mongoose = require('mongoose');

const userRankItemSchema = new mongoose.Schema({
    name: { type: String, required: true },
    minPosts: { type: Number, default: 0 },
    stars: { type: Number, default: 1 }
}, { _id: false });

const userRankSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true, default: 'ranks_config' },
    ranks: {
        type: [userRankItemSchema],
        default: [
            { name: 'Newcomer', minPosts: 0, stars: 1 },
            { name: 'Regular', minPosts: 10, stars: 2 },
            { name: 'Veteran', minPosts: 50, stars: 3 },
            { name: 'Established', minPosts: 150, stars: 4 },
            { name: 'Legend', minPosts: 500, stars: 5 }
        ]
    },
    thresholds: {
        tempBanPoints: { type: Number, default: 5 },
        permBanPoints: { type: Number, default: 10 }
    },
    updated_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('UserRank', userRankSchema);

