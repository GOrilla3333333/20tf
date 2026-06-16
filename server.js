const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const multer = require('multer');
require('dotenv').config();

const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
const PORT = process.env.PORT || 3000;

// ================= CLOUDINARY STORAGE =================
const storage = new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => {
        const isVideo = file.mimetype.startsWith("video");
        return {
            folder: "forum-app",
            resource_type: isVideo ? "video" : "image",
            allowed_formats: isVideo
                ? ["mp4", "mov", "webm", "avi", "mkv"]
                : ["jpg", "jpeg", "png", "gif", "webp"]
        };
    }
});

// ================= MULTER =================
const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 }
});

// ================= MIDDLEWARE =================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ================= DB =================
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB connected"))
    .catch(err => console.log("MongoDB connection error:", err));

// ================= MODELS =================
const User = require('./models/User');
const Forum = require('./models/Forum');
const Thread = require('./models/Thread');
const Post = require('./models/Post');
const GlobalBanner = require('./models/GlobalBanner');
const Report = require('./models/Report');
const Announcement = require('./models/Announcement');

// =====================================================
// HTML ROUTES
// =====================================================

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/forums', (req, res) => res.sendFile(path.join(__dirname, 'public', 'forums.html')));
app.get('/thread.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'thread.html')));
app.get('/tos.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tos.html')));
app.get('/commandments.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'commandments.html')));

// =====================================================
// AUTH
// =====================================================

app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.json({ success: false, message: "Missing fields" });

        const exists = await User.findOne({ username });
        if (exists) return res.json({ success: false, message: "User already exists" });

        await new User({ username, password, banned: false, tosAccepted: false }).save();
        res.json({ success: true, message: "Account created" });
    } catch (err) {
        console.error(err);
        res.json({ success: false, message: "Server error" });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username, password });

        if (!user) return res.json({ success: false, message: "Invalid credentials" });
        if (user.banned) return res.json({ success: false, message: "User is banned" });

        if (!user.tosAccepted) return res.json({ success: true, redirect: "/tos.html" });

        res.json({ success: true, message: "Login successful" });
    } catch (err) {
        console.error(err);
        res.json({ success: false, message: "Server error" });
    }
});

// =====================================================
// TOS
// =====================================================
app.post('/api/accept-tos', async (req, res) => {
    try {
        const { username } = req.body;
        if (!username) return res.json({ success: false });
        await User.findOneAndUpdate({ username }, { tosAccepted: true });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.json({ success: false });
    }
});

// =====================================================
// UPLOAD (Fixed for Videos)
// =====================================================
app.post('/api/upload', (req, res) => {
    upload.single('file')(req, res, async function(err) {
        try {
            if (err) {
                console.error("Upload error:", err);
                return res.json({ success: false, message: "Upload error: " + err.message });
            }

            if (!req.file) {
                return res.json({ success: false, message: "No file received" });
            }

            console.log("✅ File uploaded:", req.file.path); // for debugging

            res.json({
                success: true,
                url: req.file.path
            });
        } catch (e) {
            console.error(e);
            res.json({ success: false, message: "Upload failed" });
        }
    });
});

// =====================================================
// FORUMS
// =====================================================
app.get('/api/forums', async (req, res) => {
    const forums = await Forum.find();
    res.json(forums);
});

app.post('/api/forums', async (req, res) => {
    const { name, description } = req.body;
    const forum = new Forum({ id: Date.now().toString(36), name, description });
    await forum.save();
    res.json({ success: true, message: "Forum created" });
});

// =====================================================
// THREADS BY FORUM
// =====================================================
app.get('/api/forums/:forumId/threads', async (req, res) => {
    try {
        const forumId = String(req.params.forumId);
        const threads = await Thread.find({ forum_id: forumId })
            .sort({ pinned: -1, created_at: -1 });

        const result = [];
        for (const thread of threads) {
            const posts = await Post.find({ thread_id: thread.id });
            result.push({
                ...thread.toObject(),
                postCount: posts.length,
                netVotes: 0
            });
        }
        res.json(result);
    } catch (err) {
        console.error("ERROR loading threads:", err);
        res.status(500).json({ error: "Failed to load discussions" });
    }
});

// =====================================================
// ANNOUNCEMENTS (Full Support)
// =====================================================
app.get('/api/announcements', async (req, res) => {
    try {
        const announcements = await Announcement.find().sort({ pinned: -1, created_at: -1 });
        res.json(announcements);
    } catch (err) {
        console.error(err);
        res.json([]);
    }
});

app.post('/api/announcements', async (req, res) => {
    try {
        const { content, author } = req.body;
        if (author !== "20k") return res.json({ success: false, message: "Only 20k can post announcements" });

        await new Announcement({
            id: Date.now().toString(36),
            content: content.trim(),
            author: "20k",
            pinned: false,
            created_at: new Date()
        }).save();

        res.json({ success: true, message: "Announcement posted!" });
    } catch (err) {
        console.error(err);
        res.json({ success: false, message: "Server error" });
    }
});

app.put('/api/announcements/:id', async (req, res) => {
    try {
        const { content } = req.body;
        const ann = await Announcement.findOne({ id: req.params.id });
        if (!ann) return res.json({ success: false, message: "Announcement not found" });

        ann.content = content.trim();
        await ann.save();
        res.json({ success: true, message: "Announcement updated!" });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

app.delete('/api/announcements/:id', async (req, res) => {
    try {
        await Announcement.deleteOne({ id: req.params.id });
        res.json({ success: true, message: "Announcement deleted!" });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

app.post('/api/announcements/:id/pin', async (req, res) => {
    try {
        const ann = await Announcement.findOne({ id: req.params.id });
        if (!ann) return res.json({ success: false, message: "Announcement not found" });

        ann.pinned = !ann.pinned;
        await ann.save();

        res.json({ 
            success: true, 
            message: ann.pinned ? "📌 Announcement pinned!" : "📌 Announcement unpinned!" 
        });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

// =====================================================
// GLOBAL BANNER
// =====================================================
app.post('/api/admin/banner', async (req, res) => {
    try {
        const { username, text, imageUrl } = req.body;
        if (username !== "20k") return res.json({ success: false, message: "No permission" });

        await GlobalBanner.findOneAndUpdate(
            { active: true },
            { active: !!(text || imageUrl), text: text || "", imageUrl: imageUrl || "" },
            { upsert: true }
        );

        res.json({ success: true, message: text ? "Banner updated successfully!" : "Banner cleared!" });
    } catch (err) {
        console.error(err);
        res.json({ success: false, message: "Server error" });
    }
});

app.get('/api/global-banner', async (req, res) => {
    const banner = await GlobalBanner.findOne({ active: true });
    res.json(banner || { active: false });
});

// =====================================================
// OTHER ROUTES
// =====================================================

app.get('/api/threads/:threadId', async (req, res) => {
    const thread = await Thread.findOne({ id: String(req.params.threadId) });
    if (!thread) return res.json({ success: false, title: "Thread not found", creator: "Unknown" });
    res.json({
        success: true,
        id: thread.id,
        title: thread.title,
        creator: thread.user_id,
        created_at: thread.created_at
    });
});

app.get('/api/threads/:threadId/posts', async (req, res) => {
    const posts = await Post.find({ thread_id: String(req.params.threadId) }).sort({ created_at: 1 });

    const cleaned = posts.map(p => ({
        id: String(p.id),
        content: p.content,
        thread_id: String(p.thread_id),
        user_id: p.user_id,
        fileUrl: p.fileUrl,
        parent_id: p.parent_id ? String(p.parent_id) : null,
        created_at: p.created_at,
        replies: []
    }));

    const map = new Map();
    cleaned.forEach(p => map.set(p.id, p));

    const tree = [];
    cleaned.forEach(p => {
        if (p.parent_id && map.has(p.parent_id)) {
            map.get(p.parent_id).replies.push(p);
        } else {
            tree.push(p);
        }
    });

    res.json(tree);
});

app.post('/api/posts', async (req, res) => {
    const { content, thread_id, username, fileUrl, parent_id } = req.body;
    if (!content || content.trim() === "") {
        return res.json({ success: false, message: "Add some words to post the reply!" });
    }
    if (!thread_id || !username) {
        return res.json({ success: false, message: "Missing required fields" });
    }

    const post = new Post({
        id: Date.now().toString(36),
        content: content.trim(),
        thread_id: String(thread_id),
        user_id: username,
        fileUrl: fileUrl || null,
        parent_id: parent_id ? String(parent_id) : null,
        created_at: new Date()
    });

    await post.save();
    res.json({ success: true, message: parent_id ? "Reply posted!" : "Post created!" });
});

app.put('/api/posts/:postId', async (req, res) => {
    const { username, content } = req.body;
    const post = await Post.findOne({ id: req.params.postId });
    if (!post) return res.json({ success: false, message: "Post not found" });
    if (post.user_id !== username && username !== "20k") return res.json({ success: false, message: "No permission" });
    post.content = content;
    await post.save();
    res.json({ success: true, message: "Updated" });
});

app.delete('/api/posts/:postId', async (req, res) => {
    const { username } = req.body;
    const post = await Post.findOne({ id: req.params.postId });
    if (!post) return res.json({ success: false, message: "Post not found" });
    if (post.user_id !== username && username !== "20k") return res.json({ success: false, message: "No permission" });
    await Post.deleteOne({ id: req.params.postId });
    res.json({ success: true, message: "Deleted" });
});

app.delete('/api/threads/:threadId', async (req, res) => {
    const { username } = req.body;
    const thread = await Thread.findOne({ id: req.params.threadId });
    if (!thread) return res.json({ success: false, message: "Thread not found" });
    if (username !== "20k" && thread.user_id !== username) return res.json({ success: false, message: "No permission" });

    await Post.deleteMany({ thread_id: thread.id });
    await Thread.deleteOne({ id: thread.id });
    await Report.deleteMany({ post_id: thread.id });

    res.json({ success: true, message: "Thread deleted" });
});

app.post('/api/report', async (req, res) => {
    const { post_id, reported_by, reason } = req.body;
    await new Report({
        id: Date.now().toString(36),
        post_id,
        reported_by,
        reason,
        status: "pending",
        created_at: new Date()
    }).save();
    res.json({ success: true, message: "Report submitted" });
});

app.get('/api/reports', async (req, res) => {
    const reports = await Report.find().sort({ created_at: -1 });
    res.json(reports);
});

app.post('/api/reports/:id/review', async (req, res) => {
    const report = await Report.findOne({ id: req.params.id });
    if (!report) return res.json({ success: false, message: "Not found" });
    report.status = "cleared";
    await report.save();
    res.json({ success: true, message: "Report cleared" });
});

app.get('/api/check-ban/:username', async (req, res) => {
    const user = await User.findOne({ username: req.params.username });
    if (user && user.banned) {
        return res.json({
            banned: true,
            type: user.banType || "permanent",
            reason: user.banReason || "No reason"
        });
    }
    res.json({ banned: false });
});

app.post('/api/threads', async (req, res) => {
    try {
        const { title, content, forum_id, username, fileUrl } = req.body;
        if (!title || !forum_id || !username) return res.json({ success: false, message: "Missing fields" });

        const thread = new Thread({
            id: Date.now().toString(36),
            title,
            forum_id: String(forum_id),
            user_id: username,
            pinned: false,
            created_at: new Date()
        });
        await thread.save();

        if (content && content.trim()) {
            await new Post({
                id: Date.now().toString(36) + "p",
                thread_id: thread.id,
                user_id: username,
                content: content.trim(),
                fileUrl: fileUrl || null,
                parent_id: null,
                created_at: new Date()
            }).save();
        }

        res.json({ success: true, message: "d1sc created successfully!" });
    } catch (err) {
        console.error(err);
        res.json({ success: false, message: "Server error creating thread" });
    }
});

app.post('/api/admin/ban', async (req, res) => {
    try {
        const { admin, targetUsername, reason, type } = req.body;

        if (admin !== "20k") return res.json({ success: false, message: "No permission" });

        const user = await User.findOne({ username: targetUsername });
        if (!user) return res.json({ success: false, message: "User not found" });

        user.banned = true;
        user.banReason = reason || "No reason given";
        user.banType = type || "permanent";

        await user.save();

        res.json({ success: true, message: `User ${targetUsername} has been banned.` });
    } catch (err) {
        console.error(err);
        res.json({ success: false, message: "Server error" });
    }
});

app.delete('/api/admin/thread/:threadId', async (req, res) => {
    const { username } = req.body;
    if (username !== "20k") return res.json({ success: false, message: "No permission" });

    const thread = await Thread.findOne({ id: req.params.threadId });
    if (!thread) return res.json({ success: false, message: "Thread not found" });

    await Post.deleteMany({ thread_id: thread.id });
    await Thread.deleteOne({ id: thread.id });
    await Report.deleteMany({ post_id: thread.id });

    res.json({ success: true, message: "Thread deleted" });
});

app.post('/api/threads/:threadId/pin', async (req, res) => {
    try {
        const { username } = req.body;
        if (username !== "20k") return res.json({ success: false, message: "Only admin can pin" });

        const thread = await Thread.findOne({ id: req.params.threadId });
        if (!thread) return res.json({ success: false, message: "Thread not found" });

        thread.pinned = !thread.pinned;
        await thread.save();

        res.json({
            success: true,
            message: thread.pinned ? "📌 Pinned" : "📌 Unpinned"
        });
    } catch (err) {
        console.error("PIN ERROR:", err);
        res.json({ success: false, message: "Server error" });
    }
});

// =====================================================
// START SERVER
// =====================================================
app.listen(PORT, () => {
    console.log(`🚀 Running on http://localhost:${PORT}`);
});