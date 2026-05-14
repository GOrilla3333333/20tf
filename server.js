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
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const safeName = Date.now() + '-' + file.originalname.replace(/\s/g, '_');
        cb(null, safeName);
    }
});

const upload = multer({ storage });

// ================= MONGO =================
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

// ================= DEBUG LOGGER =================
app.use((req, res, next) => {
    console.log("REQ:", req.method, req.url);
    next();
});

// ================= HTML ROUTES =================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/forums', (req, res) => res.sendFile(path.join(__dirname, 'public', 'forums.html')));
app.get('/thread-list.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'thread-list.html')));
app.get('/thread.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'thread.html')));

// ================= UPLOAD ROUTE (FIXED SINGLE VERSION) =================
app.post('/api/upload', (req, res) => {
    console.log("🔥 UPLOAD ROUTE HIT");

    upload.single('file')(req, res, function (err) {
        if (err) {
            console.log("❌ MULTER ERROR:", err);
            return res.json({ success: false, message: "Upload error" });
        }

        console.log("📦 BODY:", req.body);
        console.log("📎 FILE:", req.file);

        if (!req.file) {
            console.log("❌ NO FILE RECEIVED");
            return res.json({ success: false, message: "No file received" });
        }

        console.log("✅ UPLOAD SUCCESS:", req.file.filename);

        res.json({
            success: true,
            url: `/uploads/${req.file.filename}`
        });
    });
});

// ================= AUTH =================
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password)
        return res.json({ success: false, message: "Username and password required" });

    const existing = await User.findOne({ username });
    if (existing)
        return res.json({ success: false, message: "Username already taken" });

    await new User({ username, password }).save();

    res.json({ success: true, message: "User created successfully!" });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    const user = await User.findOne({ username, password });

    if (!user)
        return res.json({ success: false, message: "Invalid username or password" });

    if (user.banned)
        return res.json({ success: false, message: "Account banned", banned: true });

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

    if (!title || !forum_id || !username)
        return res.json({ success: false, message: "Missing information" });

    const now = new Date();

    const thread = new Thread({
        id: Date.now().toString(36),
        title,
        forum_id,
        user_id: username,
        pinned: false,
        created_at: now
    });

    await thread.save();

    const post = new Post({
        id: Date.now().toString(36) + 'p',
        content: content || "",
        thread_id: thread.id,
        user_id: username,
        fileUrl: fileUrl || null,
        created_at: now
    });

    await post.save();

    res.json({ success: true, message: "d1sc created successfully!" });
});

app.put('/api/threads/:threadId', async (req, res) => {
    const { username, title, content } = req.body;

    const thread = await Thread.findOne({ id: req.params.threadId });

    if (!thread)
        return res.json({ success: false, message: "Thread not found" });

    if (thread.user_id !== username && username !== "20k")
        return res.json({ success: false, message: "No permission" });

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

    if (!thread)
        return res.json({ success: false, message: "Thread not found" });

    if (thread.user_id !== username && username !== "20k")
        return res.json({ success: false, message: "No permission" });

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

app.post('/api/posts', async (req, res) => {
    const { content, thread_id, username, fileUrl } = req.body;

    const post = new Post({
        id: Date.now().toString(36),
        content,
        thread_id,
        user_id: username,
        fileUrl: fileUrl || null,
        created_at: new Date()
    });

    await post.save();

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

// ================= REPORT =================
app.post('/api/report', async (req, res) => {
    const { post_id, reported_by, reason } = req.body;

    await new Report({
        id: Date.now().toString(36),
        post_id,
        reported_by,
        reason
    }).save();

    res.json({ success: true, message: "Report submitted" });
});

// ================= BANNER =================
app.post('/api/admin/banner', async (req, res) => {
    if (req.body.username !== "20k")
        return res.json({ success: false, message: "Admin only" });

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

// ================= BAN CHECK =================
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

// ================= START =================
app.listen(PORT, () => {
    console.log(`✅ 20Thousand Forums running at http://localhost:${PORT}`);
});