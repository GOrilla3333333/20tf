// migrate.js
const mongoose = require('mongoose');
const fs = require('fs');
require('dotenv').config();

// Import Models
const User = require('./models/User');
const Forum = require('./models/Forum');
const Thread = require('./models/Thread');
const Post = require('./models/Post');
const Vote = require('./models/Vote');
const Report = require('./models/Report');
const GlobalBanner = require('./models/GlobalBanner');

async function migrate() {
    console.log("🚀 Starting migration from data.json to MongoDB...");

    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB");

    // Clear existing data (optional - remove if you don't want to wipe)
    await Promise.all([
        User.deleteMany({}),
        Forum.deleteMany({}),
        Thread.deleteMany({}),
        Post.deleteMany({}),
        Vote.deleteMany({}),
        Report.deleteMany({}),
        GlobalBanner.deleteMany({})
    ]);

    const data = JSON.parse(fs.readFileSync('./data.json', 'utf-8'));

    // Migrate Users
    if (data.users?.length) {
        await User.insertMany(data.users);
        console.log(`✅ Migrated ${data.users.length} users`);
    }

    // Migrate Forums
    if (data.forums?.length) {
        await Forum.insertMany(data.forums);
        console.log(`✅ Migrated ${data.forums.length} forums`);
    }

    // Migrate Threads
    if (data.threads?.length) {
        await Thread.insertMany(data.threads);
        console.log(`✅ Migrated ${data.threads.length} threads`);
    }

    // Migrate Posts
    if (data.posts?.length) {
        await Post.insertMany(data.posts);
        console.log(`✅ Migrated ${data.posts.length} posts`);
    }

    // Migrate Votes
    if (data.votes?.length) {
        await Vote.insertMany(data.votes);
        console.log(`✅ Migrated ${data.votes.length} votes`);
    }

    // Migrate Reports
    if (data.reports?.length) {
        await Report.insertMany(data.reports);
        console.log(`✅ Migrated ${data.reports.length} reports`);
    }

    // Migrate Global Banner
    if (data.globalBanner) {
        await GlobalBanner.create(data.globalBanner);
        console.log("✅ Migrated Global Banner");
    }

    console.log("\n🎉 Migration completed successfully!");
    console.log("You can now delete or rename data.json");
    process.exit(0);
}

migrate().catch(err => {
    console.error("❌ Migration failed:", err);
    process.exit(1);
});