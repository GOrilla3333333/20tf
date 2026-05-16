const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ================= MIDDLEWARE =================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// ================= UPLOAD FOLDER =================
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
    console.log("📁 uploads folder created");
}

// ================= MULTER SETUP =================
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        const safeName = Date.now() + '-' + file.originalname.replace(/\s/g, '_');
        cb(null, safeName);
    }
});

const upload = multer({ storage });

// ================= MONGO CONNECTION =================
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Connected to MongoDB Atlas"))
    .catch(err => console.error("❌ MongoDB Error:", err));

// ================= MODELS =================
const User = require('./models/User');
const Forum = require('./models/Forum');
const Thread = require('./models/Thread');
const Post = require('./models/Post');
const Vote = require('./models/Vote');
const Report = require('./models/Report');
const GlobalBanner = require('./models/GlobalBanner');

// ================= HTML ROUTES =================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/forums', (req, res) => res.sendFile(path.join(__dirname, 'public', 'forums.html')));
app.get('/thread-list.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'thread-list.html')));
app.get('/thread.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'thread.html')));

// ================= UPLOAD ROUTE =================
app.post('/api/upload', (req, res) => {
    upload.single('file')(req, res, function (err) {
        if (err) return res.json({ success: false, message: "Upload error" });
        if (!req.file) return res.json({ success: false, message: "No file received" });

        res.json({
            success: true,
            url: `/uploads/${req.file.filename}`
        });
    });
});

// ================= AUTH =================
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ success: false, message: "Username and password required" });

    const existing = await User.findOne({ username });
    if (existing) return res.json({ success: false, message: "Username already taken" });

    await new User({ username, password }).save();
    res.json({ success: true, message: "User created successfully!" });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username, password });

    if (!user) return res.json({ success: false, message: "Invalid username or password" });
    if (user.banned) return res.json({ success: false, message: "Account banned", banned: true });

    res.json({ success: true, message: "Login successful" });
});

// ================= FORUMS =================
app.get('/api/forums', async (req, res) => {
    const forums = await Forum.find();
    res.json(forums);
});

app.post('/api/forums', async (req, res) => {
    const { name, description } = req.body;
    const forum = new Forum({
        id: Date.now().toString(36),
        name,
        description
    });
    await forum.save();
    res.json({ success: true, message: "Forum created" });
});

// ================= THREADS =================
app.get('/api/forums/:forumId/threads', async (req, res) => {
    const threads = await Thread.find({ forum_id: req.params.forumId });
    const result = [];

    for (const thread of threads) {
        const votes = await Vote.find({ target_type: 'thread', target_id: thread.id });
        const netVotes = votes.reduce((sum, v) => sum + v.vote_type, 0);
        result.push({ ...thread.toObject(), netVotes });
    }
    res.json(result);
});

app.post('/api/threads', async (req, res) => {
    const { title, content, forum_id, username, fileUrl } = req.body;
    if (!title || !forum_id || !username) return res.json({ success: false, message: "Missing information" });

    const thread = new Thread({
        id: Date.now().toString(36),
        title,
        forum_id,
        user_id: username,
        pinned: false,
        created_at: new Date()
    });
    await thread.save();

    const post = new Post({
        id: Date.now().toString(36) + 'p',
        content: content || "",
        thread_id: thread.id,
        user_id: username,
        fileUrl: fileUrl || null,
        created_at: new Date()
    });
    await post.save();

    res.json({ success: true, message: "d1sc created successfully!" });
});

app.put('/api/threads/:threadId', async (req, res) => {
    const { username, title, content } = req.body;
    const thread = await Thread.findOne({ id: req.params.threadId });

    if (!thread) return res.json({ success: false, message: "Thread not found" });
    if (thread.user_id !== username && username !== "20k") return res.json({ success: false, message: "No permission" });

    if (title) thread.title = title;
    await thread.save();

    if (content) {
        const post = await Post.findOne({ thread_id: thread.id });
        if (post) {
            post.content = content;
            await post.save();
        }
    }

    res.json({ success: true, message: "Updated successfully" });
});

app.delete('/api/threads/:threadId', async (req, res) => {
    const { username } = req.body;
    const thread = await Thread.findOne({ id: req.params.threadId });

    if (!thread) return res.json({ success: false, message: "Thread not found" });
    if (thread.user_id !== username && username !== "20k") return res.json({ success: false, message: "No permission" });

    await Thread.deleteOne({ id: thread.id });
    await Post.deleteMany({ thread_id: thread.id });

    res.json({ success: true, message: "Deleted successfully" });
});

// ================= POSTS =================
app.get('/api/threads/:threadId/posts', async (req, res) => {
    const posts = await Post.find({ thread_id: req.params.threadId }).sort({ created_at: 1 });
    const result = [];

    for (const post of posts) {
        const votes = await Vote.find({ target_type: 'post', target_id: post.id });
        const netVotes = votes.reduce((sum, v) => sum + v.vote_type, 0);
        result.push({ ...post.toObject(), netVotes });
    }
    res.json(result);
});

// === CREATE POST / REPLY ===
app.post('/api/posts', async (req, res) => {
    const { content, thread_id, username, fileUrl, parent_id } = req.body;

    if (!content || !thread_id || !username) {
        return res.json({ success: false, message: "Missing information" });
    }

    const newPost = new Post({
        id: Date.now().toString(36),
        content: content.trim(),
        thread_id,
        user_id: username,
        fileUrl: fileUrl || null,
        parent_id: parent_id || null,     // ← This is the important line
        created_at: new Date()
    });

    await newPost.save();
    console.log(`💬 New post created | parent_id: ${parent_id || 'null'}`);
    
    res.json({ success: true, message: "Reply posted!" });
});

// ================= VOTES =================
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
            return res.json({ success: true, message: "Vote changed" });
        }
    }

    await new Vote({
        id: Date.now().toString(36),
        user_id: username,
        target_type,
        target_id,
        vote_type
    }).save();

    res.json({ success: true, message: "Voted!" });
});

// ================= REPORTS =================
app.post('/api/report', async (req, res) => {
    const { post_id, reported_by, reason } = req.body;

    await new Report({
        id: Date.now().toString(36),
        post_id,
        reported_by,
        reason,
        status: "pending"
    }).save();

    res.json({ success: true, message: "Report submitted" });
});

// ✅ FIXED ROUTE
app.get('/api/reports', async (req, res) => {
    if (req.query.username !== "20k") {
        return res.json({ success: false, message: "Admin access only" });
    }

    const reports = await Report.find().sort({ created_at: -1 });
    res.json(reports);
});

app.post('/api/reports/:reportId/review', async (req, res) => {
    if (req.body.username !== "20k") return res.json({ success: false, message: "Admin only" });

    const report = await Report.findOne({ id: req.params.reportId });
    if (report) {
        report.status = "reviewed";
        await report.save();
        res.json({ success: true, message: "Report marked as reviewed" });
    } else {
        res.json({ success: false, message: "Report not found" });
    }
});

// ================= BANNER & BAN =================
app.post('/api/admin/banner', async (req, res) => {
    if (req.body.username !== "20k") return res.json({ success: false, message: "Admin only" });

    await GlobalBanner.deleteMany({});
    await new GlobalBanner({
        text: req.body.text,
        imageUrl: req.body.imageUrl,
        active: true
    }).save();

    res.json({ success: true, message: "Banner updated" });
});

app.get('/api/global-banner', async (req, res) => {
    const banner = await GlobalBanner.findOne({ active: true });
    res.json(banner || { active: false });
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

// ================= PIN THREAD (Admin Only) =================
app.post('/api/threads/:threadId/pin', async (req, res) => {
    if (req.body.username !== "20k") {
        return res.json({ success: false, message: "Only 20k can pin threads" });
    }

    const thread = await Thread.findOne({ id: req.params.threadId });
    if (!thread) {
        return res.json({ success: false, message: "Thread not found" });
    }

    thread.pinned = !thread.pinned;
    await thread.save();

    res.json({ 
        success: true, 
        message: thread.pinned ? "📌 Thread pinned at the top" : "📌 Thread unpinned",
        pinned: thread.pinned 
    });
});

// ================= EDIT POST =================
app.put('/api/posts/:postId', async (req, res) => {
    const { username, content } = req.body;
    const post = await Post.findOne({ id: req.params.postId });

    if (!post) return res.json({ success: false, message: "Post not found" });

    // Only creator or 20k can edit
    if (post.user_id !== username && username !== "20k") {
        return res.json({ success: false, message: "You can only edit your own posts" });
    }

    if (content) post.content = content;
    await post.save();

    res.json({ success: true, message: "Post updated successfully" });
});

// Delete individual reply/post
app.delete('/api/posts/:postId', async (req, res) => {
    const { username } = req.body;
    const post = await Post.findOne({ id: req.params.postId });

    if (!post) return res.json({ success: false, message: "Post not found" });

    if (post.user_id !== username && username !== "20k") {
        return res.json({ success: false, message: "You can only delete your own replies" });
    }

    await Post.deleteOne({ id: req.params.postId });
    res.json({ success: true, message: "Reply deleted successfully" });
});

// ================= START =================
app.listen(PORT, () => {
    console.log(`✅ 20Thousand Forums running at http://localhost:${PORT}`);
});