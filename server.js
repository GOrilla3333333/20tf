const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Multer Setup
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Connected to MongoDB Atlas"))
    .catch(err => console.error("❌ MongoDB Error:", err));

// Import Models
const User = require('./models/User');
const Forum = require('./models/Forum');
const Thread = require('./models/Thread');
const Post = require('./models/Post');
const Vote = require('./models/Vote');
const Report = require('./models/Report');
const GlobalBanner = require('./models/GlobalBanner');

// === HTML ROUTES ===
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/forums', (req, res) => res.sendFile(path.join(__dirname, 'public', 'forums.html')));
app.get('/thread-list.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'thread-list.html')));
app.get('/thread.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'thread.html')));

// === UPLOAD ROUTE ===
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.json({ success: false, message: "No file uploaded" });
    res.json({ success: true, url: `/uploads/${req.file.filename}` });
});

// === AUTH ROUTES ===
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ success: false, message: "Username and password required" });

    const existing = await User.findOne({ username });
    if (existing) return res.json({ success: false, message: "Username already taken" });

    const newUser = new User({ username, password });
    await newUser.save();
    res.json({ success: true, message: "User created successfully!" });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username, password });
    
    if (user) {
        if (user.banned) {
            return res.json({ success: false, message: "Account banned", banned: true });
        }
        res.json({ success: true, message: "Login successful" });
    } else {
        res.json({ success: false, message: "Invalid username or password" });
    }
});

// === FORUMS ===
app.get('/api/forums', async (req, res) => {
    const forums = await Forum.find();
    res.json(forums);
});

app.post('/api/forums', async (req, res) => {
    const { name, description } = req.body;
    const newForum = new Forum({ id: Date.now().toString(36), name, description });
    await newForum.save();
    res.json({ success: true, message: "Forum created" });
});

// === THREADS ===
app.get('/api/forums/:forumId/threads', async (req, res) => {
    const threads = await Thread.find({ forum_id: req.params.forumId });
    const threadsWithVotes = [];

    for (let thread of threads) {
        const votes = await Vote.find({ target_type: 'thread', target_id: thread.id });
        const netVotes = votes.reduce((sum, v) => sum + v.vote_type, 0);
        threadsWithVotes.push({ ...thread.toObject(), netVotes });
    }
    res.json(threadsWithVotes);
});

app.post('/api/threads', async (req, res) => {
    const { title, content, forum_id, username, fileUrl } = req.body;
    if (!title || !forum_id || !username) return res.json({ success: false, message: "Missing information" });

    const newThread = new Thread({
        id: Date.now().toString(36),
        title,
        forum_id,
        user_id: username,
        pinned: false
    });
    await newThread.save();

    const firstPost = new Post({
        id: Date.now().toString(36) + 'p',
        content: content || "",
        thread_id: newThread.id,
        user_id: username,
        fileUrl
    });
    await firstPost.save();

    res.json({ success: true, message: "d1sc created successfully!" });
});

app.put('/api/threads/:threadId', async (req, res) => {
    const { username, title, content } = req.body;
    const thread = await Thread.findOne({ id: req.params.threadId });

    if (!thread) return res.json({ success: false, message: "Thread not found" });
    if (thread.user_id !== username && username !== "20k") {
        return res.json({ success: false, message: "You can only edit your own d1sc" });
    }

    if (title) thread.title = title;
    await thread.save();

    if (content) {
        const firstPost = await Post.findOne({ thread_id: req.params.threadId });
        if (firstPost) {
            firstPost.content = content;
            await firstPost.save();
        }
    }

    res.json({ success: true, message: "d1sc updated successfully" });
});

app.post('/api/threads/:threadId/pin', async (req, res) => {
    if (req.body.username !== "20k") return res.json({ success: false, message: "Only 20k can pin" });

    const thread = await Thread.findOne({ id: req.params.threadId });
    if (!thread) return res.json({ success: false, message: "Thread not found" });

    thread.pinned = !thread.pinned;
    await thread.save();

    res.json({ success: true, message: thread.pinned ? "📌 Thread pinned" : "📌 Thread unpinned" });
});

app.delete('/api/threads/:threadId', async (req, res) => {
    const { username } = req.body;
    const thread = await Thread.findOne({ id: req.params.threadId });

    if (!thread) return res.json({ success: false, message: "Thread not found" });
    if (thread.user_id !== username && username !== "20k") {
        return res.json({ success: false, message: "You can only delete your own d1sc" });
    }

    await Thread.deleteOne({ id: req.params.threadId });
    await Post.deleteMany({ thread_id: req.params.threadId });

    res.json({ success: true, message: "d1sc deleted successfully" });
});

// === POSTS ===
app.get('/api/threads/:threadId/posts', async (req, res) => {
    const posts = await Post.find({ thread_id: req.params.threadId }).sort({ created_at: 1 });
    const postsWithVotes = [];

    for (let post of posts) {
        const votes = await Vote.find({ target_type: 'post', target_id: post.id });
        const netVotes = votes.reduce((sum, v) => sum + v.vote_type, 0);
        postsWithVotes.push({ ...post.toObject(), netVotes });
    }
    res.json(postsWithVotes);
});

app.post('/api/posts', async (req, res) => {
    const { content, thread_id, username, fileUrl } = req.body;
    const newPost = new Post({
        id: Date.now().toString(36),
        content,
        thread_id,
        user_id: username,
        fileUrl
    });
    await newPost.save();
    res.json({ success: true, message: "Reply posted!" });
});

// === VOTES ===
app.post('/api/vote', async (req, res) => {
    const { target_type, target_id, vote_type, username } = req.body;

    const existing = await Vote.findOne({ target_type, target_id, user_id: username });

    if (existing) {
        if (existing.vote_type === vote_type) {
            await Vote.deleteOne({ _id: existing._id });
            return res.json({ success: true, message: "Vote removed" });
        } else {
            existing.vote_type = vote_type;
            await existing.save();
            return res.json({ success: true, message: vote_type === 1 ? "Changed to Upvote" : "Changed to Downvote" });
        }
    } else {
        const newVote = new Vote({
            id: Date.now().toString(36),
            user_id: username,
            target_type,
            target_id,
            vote_type
        });
        await newVote.save();
        res.json({ success: true, message: vote_type === 1 ? "Upvoted!" : "Downvoted!" });
    }
});

// === REPORTS ===
app.post('/api/report', async (req, res) => {
    const { post_id, reported_by, reason } = req.body;
    const newReport = new Report({ id: Date.now().toString(36), post_id, reported_by, reason });
    await newReport.save();
    res.json({ success: true, message: "Report submitted successfully" });
});

// === GLOBAL BANNER ===
app.post('/api/admin/banner', async (req, res) => {
    if (req.body.username !== "20k") return res.json({ success: false, message: "Admin only" });

    await GlobalBanner.deleteMany({});
    const banner = new GlobalBanner({
        text: req.body.text,
        imageUrl: req.body.imageUrl,
        active: true
    });
    await banner.save();
    res.json({ success: true, message: "Global banner updated" });
});

app.get('/api/global-banner', async (req, res) => {
    const banner = await GlobalBanner.findOne({ active: true });
    res.json(banner || { active: false });
});

// === BAN CHECK ===
app.get('/api/check-ban/:username', async (req, res) => {
    const user = await User.findOne({ username: req.params.username });
    if (user && user.banned) {
        res.json({
            banned: true,
            type: user.banType || "permanent",
            reason: user.banReason || "No reason given"
        });
    } else {
        res.json({ banned: false });
    }
});

app.listen(PORT, () => {
    console.log(`✅ 20Thousand Forums running at http://localhost:${PORT}`);
});