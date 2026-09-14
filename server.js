const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const multer = require('multer');
require('dotenv').config();

const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const app = express();
const PORT = process.env.PORT || 3000;

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

const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB connected"))
    .catch(err => console.log("MongoDB connection error:", err));

const User = require('./models/User');
const Forum = require('./models/Forum');
const Thread = require('./models/Thread');
const Post = require('./models/Post');
const GlobalBanner = require('./models/GlobalBanner');
const Report = require('./models/Report');
const Announcement = require('./models/Announcement');
const ProfileComment = require('./models/ProfileComment');
const Alert = require('./models/Alert');

async function canMod(username) {
    if (!username) return false;
    if (username === "20k") return true;
    const user = await User.findOne({ username });
    if (!user) return false;
    const t = (user.title || "").toLowerCase();
    return t === "owner" || t === "moderator" || t === "mod";
}

async function canStaff(username) {
    if (!username) return false;
    if (username === "20k") return true;
    const user = await User.findOne({ username });
    if (!user) return false;
    const t = (user.title || "").toLowerCase();
    return t === "owner" || t === "moderator" || t === "mod" || t === "janitor";
}

async function pingUser(username) {
    if (!username) return;
    try {
        await User.collection.updateOne(
            { username },
            { $set: { lastSeen: new Date() } }
        );
    } catch (e) {}
}

async function createAlert({ to_user, from_user, type, message, link, threadTitle }) {
    if (!to_user || !from_user) return;
    if (to_user === from_user) return;
    try {
        await new Alert({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            to_user,
            from_user,
            type: type || "reply",
            message: message || "",
            link: link || "/",
            threadTitle: threadTitle || "",
            read: false,
            created_at: new Date()
        }).save();
    } catch (e) {
        console.error("createAlert error:", e);
    }
}

async function notifyMentions(text, fromUser, link, threadTitle) {
    if (!text || !fromUser) return;
    const mentionRegex = /@([a-zA-Z0-9_]{1,32})/g;
    const mentioned = new Set();
    let m;
    while ((m = mentionRegex.exec(text)) !== null) mentioned.add(m[1]);
    for (const name of mentioned) {
        if (name === fromUser) continue;
        const exists = await User.findOne({ username: name });
        if (!exists) continue;
        await createAlert({
            to_user: name,
            from_user: fromUser,
            type: 'mention',
            message: fromUser + ' tagged you',
            threadTitle: threadTitle || '',
            link: link || '/'
        });
    }
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/forums', (req, res) => res.sendFile(path.join(__dirname, 'public', 'forums.html')));
app.get('/thread.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'thread.html')));
app.get('/tos.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tos.html')));
app.get('/commandments.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'commandments.html')));
app.get('/profile.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'profile.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/banned.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'banned.html')));
app.get('/search.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'search.html')));
app.get('/alerts.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'alerts.html')));

app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.json({ success: false, message: "Missing fields" });
        const exists = await User.findOne({ username });
        if (exists) return res.json({ success: false, message: "User already exists" });
        await new User({ username, password, banned: false, tosAccepted: false, title: "Member" }).save();
        res.json({ success: true, message: "Account created" });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username, password });
        if (!user) return res.json({ success: false, message: "Invalid credentials" });
        if (user.banned) return res.json({ success: false, message: "User is banned" });
        pingUser(username);
        if (!user.tosAccepted) return res.json({ success: true, redirect: "/tos.html" });
        res.json({ success: true, message: "Login successful" });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

app.post('/api/accept-tos', async (req, res) => {
    try {
        const { username } = req.body;
        if (!username) return res.json({ success: false });
        await User.findOneAndUpdate({ username }, { tosAccepted: true });
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false });
    }
});

app.post('/api/upload', (req, res) => {
    upload.single('file')(req, res, async function (err) {
        try {
            if (err) return res.json({ success: false, message: "Upload error: " + err.message });
            if (!req.file) return res.json({ success: false, message: "No file received" });
            console.log("✅ File uploaded:", req.file.path);
            res.json({ success: true, url: req.file.path });
        } catch (e) {
            res.json({ success: false, message: "Upload failed" });
        }
    });
});

app.get('/api/forums', async (req, res) => res.json(await Forum.find()));

app.post('/api/forums', async (req, res) => {
    const { name, description } = req.body;
    await new Forum({ id: Date.now().toString(36), name, description }).save();
    res.json({ success: true, message: "Forum created" });
});

app.get('/api/forum-stats', async (req, res) => {
    try {
        const forums = ['pit', 'srs', 'br', 'pol', 'crt', 'media', 'tech', 'cnfs', 'ot', 'qna', 'news'];
        const stats = {};
        for (const id of forums) {
            const threads = await Thread.find({ forum_id: id });
            const threadCount = threads.length;
            let last = null;
            if (threadCount > 0) {
                const threadIds = threads.map(t => t.id);
                const lastPost = await Post.findOne({ thread_id: { $in: threadIds } }).sort({ created_at: -1 });
                if (lastPost) {
                    const thread = threads.find(t => t.id === lastPost.thread_id);
                    last = {
                        title: thread ? thread.title : "Unknown",
                        user: lastPost.user_id,
                        at: lastPost.created_at,
                        threadId: lastPost.thread_id
                    };
                } else {
                    const newest = [...threads].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
                    last = {
                        title: newest.title,
                        user: newest.user_id,
                        at: newest.created_at,
                        threadId: newest.id
                    };
                }
            }
            stats[id] = { threads: threadCount, last };
        }
        res.json(stats);
    } catch (err) {
        res.json({});
    }
});

app.get('/api/forums/:forumId/threads', async (req, res) => {
    try {
        const forumId = String(req.params.forumId);
        const threads = await Thread.find({ forum_id: forumId }).sort({ pinned: -1, created_at: -1 });
        const result = [];
        for (const thread of threads) {
            const posts = await Post.find({ thread_id: thread.id });
            result.push({
                ...thread.toObject(),
                postCount: posts.length,
                views: thread.views || 0,
                locked: !!thread.locked,
                prefix: thread.prefix || ""
            });
        }
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: "Failed to load discussions" });
    }
});

app.get('/api/announcements', async (req, res) => {
    try {
        res.json(await Announcement.find().sort({ pinned: -1, created_at: -1 }));
    } catch (err) {
        res.json([]);
    }
});

app.post('/api/announcements', async (req, res) => {
    try {
        const { content, author } = req.body;
        if (author !== "20k") return res.json({ success: false, message: "Only 20k can post announcements" });
        await notifyMentions(content, '20k', '/', 'Announcement');
        await new Announcement({
            id: Date.now().toString(36),
            content: content.trim(),
            author: "20k",
            pinned: false,
            created_at: new Date()
        }).save();
        res.json({ success: true, message: "Announcement posted!" });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

app.put('/api/announcements/:id', async (req, res) => {
    try {
        const ann = await Announcement.findOne({ id: req.params.id });
        if (!ann) return res.json({ success: false, message: "Announcement not found" });
        ann.content = (req.body.content || "").trim();
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
        res.json({ success: true, message: ann.pinned ? "📌 Announcement pinned!" : "📌 Announcement unpinned!" });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

app.post('/api/admin/banner', async (req, res) => {
    try {
        const { username, text, imageUrl } = req.body;
        if (text) await notifyMentions(text, '20k', '/', 'Global banner');
        if (username !== "20k") return res.json({ success: false, message: "No permission" });
        await GlobalBanner.findOneAndUpdate(
            { active: true },
            { active: !!(text || imageUrl), text: text || "", imageUrl: imageUrl || "" },
            { upsert: true }
        );
        res.json({ success: true, message: text ? "Banner updated successfully!" : "Banner cleared!" });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

app.get('/api/global-banner', async (req, res) => {
    const banner = await GlobalBanner.findOne({ active: true });
    res.json(banner || { active: false });
});

app.get('/api/threads/:threadId', async (req, res) => {
    try {
        const thread = await Thread.findOne({ id: String(req.params.threadId) });
        if (!thread) return res.json({ success: false, title: "Thread not found", creator: "Unknown" });
        thread.views = (thread.views || 0) + 1;
        await thread.save();
        res.json({
            success: true,
            id: thread.id,
            title: thread.title,
            creator: thread.user_id,
            created_at: thread.created_at,
            views: thread.views,
            locked: !!thread.locked,
            prefix: thread.prefix || ""
        });
    } catch (err) {
        res.json({ success: false, title: "Thread not found", creator: "Unknown" });
    }
});

app.post('/api/posts', async (req, res) => {
    try {
        const { content, thread_id, username, fileUrl, fileUrls, parent_id } = req.body;
        if (!thread_id || !username) return res.json({ success: false, message: "Missing required fields" });

        const threadCheck = await Thread.findOne({ id: String(thread_id) });
        if (threadCheck && threadCheck.locked) {
            const isMod = await canMod(username);
            if (!isMod) return res.json({ success: false, message: "This thread is locked" });
        }

        const allFiles = Array.isArray(fileUrls) ? fileUrls : (fileUrl ? [fileUrl] : []);
        const post = new Post({
            id: Date.now().toString(36),
            content: content ? content.trim() : "",
            thread_id: String(thread_id),
            user_id: username,
            fileUrl: allFiles[0] || null,
            fileUrls: allFiles,
            parent_id: parent_id ? String(parent_id) : null,
            created_at: new Date()
        });
        await post.save();

        try {
            const thread = threadCheck || await Thread.findOne({ id: String(thread_id) });
            if (thread && thread.user_id) {
                await createAlert({
                    to_user: thread.user_id,
                    from_user: username,
                    type: "thread_reply",
                    message: `${username} replied in your d1sc`,
                    threadTitle: thread.title || "Untitled",
                    link: `/thread.html?id=${thread.id}&title=${encodeURIComponent(thread.title || "")}`
                });
            }
            if (parent_id) {
                const parent = await Post.findOne({ id: String(parent_id) });
                if (parent && parent.user_id && parent.user_id !== (thread && thread.user_id)) {
                    await createAlert({
                        to_user: parent.user_id,
                        from_user: username,
                        type: "reply",
                        message: `${username} replied to your post`,
                        threadTitle: (thread && thread.title) || "",
                        link: `/thread.html?id=${thread_id}#post-${parent_id}`
                    });

                            // @mentions → alerts

    await notifyMentions(
    content,
    username,
    '/thread.html?id=' + thread_id + '&title=' + encodeURIComponent((threadCheck && threadCheck.title) || ''),
    (threadCheck && threadCheck.title) || ''
);
        try {
            const mentionRegex = /@([a-zA-Z0-9_]{1,32})/g;
            const mentioned = new Set();
            let m;
            const text = content || '';
            while ((m = mentionRegex.exec(text)) !== null) {
                mentioned.add(m[1]);
            }
            for (const name of mentioned) {
                if (name === username) continue;
                const exists = await User.findOne({ username: name });
                if (!exists) continue;
                await createAlert({
                    to_user: name,
                    from_user: username,
                    type: 'mention',
                    message: `${username} tagged you`,
                    threadTitle: (threadCheck && threadCheck.title) || '',
                    link: `/thread.html?id=${thread_id}&title=${encodeURIComponent((threadCheck && threadCheck.title) || '')}`
                });
            }
        } catch (e) {
            console.error('Mention alert error:', e);
        }

                }
            }
        } catch (e) {}

        res.json({ success: true, message: parent_id ? "Reply posted!" : "Post created!" });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

app.get('/api/threads/:threadId/posts', async (req, res) => {
    try {
        const posts = await Post.find({ thread_id: String(req.params.threadId) }).sort({ created_at: 1 });
        const cleaned = [];
        for (const p of posts) {
            const user = await User.findOne({ username: p.user_id });
            cleaned.push({
                id: String(p.id),
                content: p.content || "",
                thread_id: String(p.thread_id),
                user_id: p.user_id,
                pfp: user?.pfp || "https://i.imgur.com/oJCfWc8.png",
                fileUrl: p.fileUrl,
                fileUrls: p.fileUrls || (p.fileUrl ? [p.fileUrl] : []),
                parent_id: p.parent_id ? String(p.parent_id) : null,
                created_at: p.created_at,
                replies: []
            });
        }
        const map = new Map();
        cleaned.forEach(p => map.set(p.id, p));
        const tree = [];
        cleaned.forEach(p => {
            if (p.parent_id && map.has(p.parent_id)) map.get(p.parent_id).replies.push(p);
            else tree.push(p);
        });
        res.json(tree);
    } catch (err) {
        res.json([]);
    }
});

app.post('/api/threads', async (req, res) => {
    try {
        const { title, content, forum_id, username, fileUrl, fileUrls, prefix } = req.body;
        if (!title || !forum_id || !username) return res.json({ success: false, message: "Missing fields" });

        if (String(forum_id) === "news") {
            if (!(await canStaff(username))) {
                return res.json({ success: false, message: "Only Owner, Moderator, and Janitor can post in News & Announcements" });
            }
        }

        await notifyMentions(
    content || '',
    username,
    '/thread.html?id=' + thread.id + '&title=' + encodeURIComponent(title || ''),
    title || ''
);

        const thread = new Thread({
            id: Date.now().toString(36),
            title,
            forum_id: String(forum_id),
            user_id: username,
            prefix: (prefix || "").trim().slice(0, 32),
            pinned: false,
            locked: false,
            views: 0,
            created_at: new Date()
        });
        await thread.save();

        const allFiles = fileUrls || (fileUrl ? [fileUrl] : []);
        await new Post({
            id: Date.now().toString(36) + "p",
            thread_id: thread.id,
            user_id: username,
            content: content ? content.trim() : "",
            fileUrl: allFiles[0] || null,
            fileUrls: allFiles,
            parent_id: null,
            created_at: new Date()
        }).save();

        res.json({ success: true, message: "d1sc created successfully!" });
    } catch (err) {
        console.error(err);
        res.json({ success: false, message: "Server error creating thread" });
    }
});

app.post('/api/threads/:threadId/lock', async (req, res) => {
    try {
        const { username } = req.body;
        if (!(await canMod(username))) {
            return res.json({ success: false, message: "Only Owner/Moderator can lock threads" });
        }
        const thread = await Thread.findOne({ id: String(req.params.threadId) });
        if (!thread) return res.json({ success: false, message: "Thread not found" });
        thread.locked = !thread.locked;
        await thread.save();
        res.json({
            success: true,
            locked: thread.locked,
            message: thread.locked ? "🔒 Thread locked" : "🔓 Thread unlocked"
        });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

app.post('/api/profile/update', async (req, res) => {
    try {
        const { username, bio, pfp, banner } = req.body;
        if (!username) return res.json({ success: false, message: "Missing username" });
        const $set = {};
        if (typeof bio === "string") $set.bio = bio;
        if (typeof pfp === "string" && pfp) $set.pfp = pfp;
        if (typeof banner === "string" && banner) $set.banner = banner;
        if (!Object.keys($set).length) return res.json({ success: false, message: "Nothing to update" });
        await User.collection.updateOne({ username }, { $set });
        const user = await User.collection.findOne({ username });
        if (!user) return res.json({ success: false, message: "User not found" });
        res.json({
            success: true,
            message: "Profile updated!",
            pfp: user.pfp || "",
            banner: user.banner || "",
            bio: user.bio || ""
        });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

app.get('/api/profile/:username', async (req, res) => {
    try {
        const user = await User.collection.findOne({ username: req.params.username });
        if (!user) return res.json({ success: false, message: "User not found" });
        const postCount = await Post.countDocuments({ user_id: user.username });
        let title = user.title || "Member";
        if (user.username === "20k" && !user.title) title = "Owner";
        res.json({
            success: true,
            username: user.username,
            pfp: user.pfp || "https://i.imgur.com/oJCfWc8.png",
            banner: user.banner || "",
            bio: user.bio || "No bio yet.",
            title,
            postCount,
            created_at: user.created_at
        });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

app.get('/api/profile/:username/comments', async (req, res) => {
    try {
        const comments = await ProfileComment.find({ profile_username: req.params.username }).sort({ created_at: -1 });
        const result = [];
        for (const c of comments) {
            const user = await User.findOne({ username: c.user_id });
            result.push({
                id: c.id,
                user_id: c.user_id,
                pfp: user?.pfp || "https://i.imgur.com/oJCfWc8.png",
                content: c.content,
                created_at: c.created_at
            });
        }
        res.json(result);
    } catch (err) {
        res.json([]);
    }
});

app.post('/api/profile/:username/comments', async (req, res) => {
    try {
        const { username, content } = req.body;
        if (!username || !content || !content.trim()) {
            return res.json({ success: false, message: "Add some words" });
        }
        const target = await User.findOne({ username: req.params.username });
        if (!target) return res.json({ success: false, message: "User not found" });
        await new ProfileComment({
            id: Date.now().toString(36),
            profile_username: req.params.username,
            user_id: username,
            content: content.trim(),
            created_at: new Date()
        }).save();
        await createAlert({
            to_user: req.params.username,
            from_user: username,
            type: "profile_comment",
            message: `${username} commented on your profile`,
            threadTitle: "",
            link: `/profile.html?user=${encodeURIComponent(req.params.username)}`
        });
        res.json({ success: true, message: "Comment posted" });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

app.delete('/api/profile/comments/:id', async (req, res) => {
    try {
        const { username } = req.body;
        const comment = await ProfileComment.findOne({ id: req.params.id });
        if (!comment) return res.json({ success: false, message: "Not found" });
        if (username !== "20k" && username !== comment.user_id && username !== comment.profile_username) {
            return res.json({ success: false, message: "No permission" });
        }
        await ProfileComment.deleteOne({ id: req.params.id });
        res.json({ success: true, message: "Deleted" });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

app.get('/api/profile/:username/activity', async (req, res) => {
    try {
        const name = req.params.username;
        const threads = await Thread.find({ user_id: name }).sort({ created_at: -1 }).limit(40);
        const posts = await Post.find({ user_id: name }).sort({ created_at: -1 }).limit(60);
        const activity = [];
        for (const t of threads) {
            activity.push({
                type: "thread",
                id: t.id,
                title: t.title,
                created_at: t.created_at,
                url: `/thread.html?id=${t.id}&title=${encodeURIComponent(t.title || "")}`
            });
        }
        for (const p of posts) {
            const thread = await Thread.findOne({ id: p.thread_id });
            if (!p.parent_id && thread && thread.user_id === name && thread.id === p.thread_id) continue;
            const title = thread ? thread.title : "Unknown thread";
            activity.push({
                type: "comment",
                id: p.id,
                thread_id: p.thread_id,
                title,
                preview: (p.content || "").slice(0, 140),
                created_at: p.created_at,
                url: `/thread.html?id=${p.thread_id}&title=${encodeURIComponent(title)}#post-${p.id}`
            });
        }
        activity.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        res.json(activity.slice(0, 80));
    } catch (err) {
        res.json([]);
    }
});

app.get('/api/alerts/:username', async (req, res) => {
    try {
        const alerts = await Alert.find({ to_user: req.params.username }).sort({ created_at: -1 }).limit(50);
        const unread = await Alert.countDocuments({ to_user: req.params.username, read: false });
        res.json({ alerts, unread });
    } catch (err) {
        res.json({ alerts: [], unread: 0 });
    }
});

app.post('/api/alerts/read-all', async (req, res) => {
    try {
        const { username } = req.body;
        if (!username) return res.json({ success: false });
        await Alert.updateMany({ to_user: username, read: false }, { $set: { read: true } });
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false });
    }
});

app.post('/api/alerts/:id/read', async (req, res) => {
    try {
        const { username } = req.body;
        await Alert.updateOne({ id: req.params.id, to_user: username }, { $set: { read: true } });
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false });
    }
});

app.post('/api/admin/title', async (req, res) => {
    try {
        const { admin, targetUsername, title } = req.body;
        if (admin !== "20k") return res.json({ success: false, message: "No permission" });
        if (!targetUsername) return res.json({ success: false, message: "Enter a username" });
        const cleanTitle = (title || "Member").trim().slice(0, 40);
        const result = await User.collection.updateOne(
            { username: targetUsername },
            { $set: { title: cleanTitle } }
        );
        if (result.matchedCount === 0) return res.json({ success: false, message: "User not found" });
        res.json({ success: true, message: `Title for ${targetUsername} set to "${cleanTitle}"` });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

app.get('/api/search', async (req, res) => {
    try {
        const raw = (req.query.q || "").trim();
        if (!raw) return res.json({ users: [], threads: [] });
        const lower = raw.toLowerCase();
        let users = [];
        let threads = [];

        if (lower.startsWith("user:")) {
            const term = raw.slice(5).trim();
            if (term) {
                const exact = await User.findOne({ username: term });
                const partial = await User.find({
                    username: { $regex: term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" }
                }).limit(30);
                const seen = new Set();
                const list = [];
                if (exact) { seen.add(exact.username); list.push(exact); }
                for (const u of partial) {
                    if (!seen.has(u.username)) { seen.add(u.username); list.push(u); }
                }
                for (const u of list) {
                    const postCount = await Post.countDocuments({ user_id: u.username });
                    users.push({
                        username: u.username,
                        pfp: u.pfp || "https://i.imgur.com/oJCfWc8.png",
                        title: u.title || (u.username === "20k" ? "Owner" : "Member"),
                        bio: u.bio || "",
                        postCount,
                        created_at: u.created_at
                    });
                }
            }
            return res.json({ users, threads: [] });
        }

        if (lower.startsWith("d1sc:")) {
            const term = raw.slice(5).trim();
            if (term) {
                const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const exact = await Thread.find({ title: term }).limit(20);
                const partial = await Thread.find({
                    title: { $regex: escaped, $options: "i" }
                }).sort({ created_at: -1 }).limit(40);
                const seen = new Set();
                const list = [];
                for (const t of exact) { if (!seen.has(t.id)) { seen.add(t.id); list.push(t); } }
                for (const t of partial) { if (!seen.has(t.id)) { seen.add(t.id); list.push(t); } }
                threads = list.map(t => ({
                    id: t.id,
                    title: t.title,
                    forum_id: t.forum_id,
                    user_id: t.user_id,
                    created_at: t.created_at,
                    pinned: t.pinned || false,
                    prefix: t.prefix || ""
                }));
            }
            return res.json({ users: [], threads });
        }

        const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const userHits = await User.find({ username: { $regex: escaped, $options: "i" } }).limit(15);
        for (const u of userHits) {
            const postCount = await Post.countDocuments({ user_id: u.username });
            users.push({
                username: u.username,
                pfp: u.pfp || "https://i.imgur.com/oJCfWc8.png",
                title: u.title || (u.username === "20k" ? "Owner" : "Member"),
                bio: u.bio || "",
                postCount,
                created_at: u.created_at
            });
        }
        const threadHits = await Thread.find({ title: { $regex: escaped, $options: "i" } }).sort({ created_at: -1 }).limit(30);
        threads = threadHits.map(t => ({
            id: t.id,
            title: t.title,
            forum_id: t.forum_id,
            user_id: t.user_id,
            created_at: t.created_at,
            pinned: t.pinned || false,
            prefix: t.prefix || ""
        }));
        res.json({ users, threads });
    } catch (err) {
        res.json({ users: [], threads: [] });
    }
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

app.get('/api/reports', async (req, res) => res.json(await Report.find().sort({ created_at: -1 })));

app.post('/api/reports/:id/review', async (req, res) => {
    const report = await Report.findOne({ id: req.params.id });
    if (!report) return res.json({ success: false, message: "Not found" });
    report.status = "cleared";
    await report.save();
    res.json({ success: true, message: "Report cleared" });
});

app.get('/api/check-ban/:username', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username });
        if (user) pingUser(user.username);
        if (user && user.banned) {
            return res.json({
                banned: true,
                type: user.banType || "permanent",
                reason: user.banReason || "No reason"
            });
        }
        res.json({ banned: false });
    } catch (err) {
        res.status(500).json({ banned: false, error: true });
    }
});

app.post('/api/heartbeat', async (req, res) => {
    try {
        const { username } = req.body;
        if (username) await pingUser(username);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false });
    }
});

app.get('/api/online-stats', async (req, res) => {
    try {
        const cutoff = new Date(Date.now() - 5 * 60 * 1000);
        const [members, threads, posts, onlineUsers] = await Promise.all([
            User.countDocuments({}),
            Thread.countDocuments({}),
            Post.countDocuments({}),
            User.find({ lastSeen: { $gte: cutoff } })
                .select('username pfp title lastSeen')
                .sort({ lastSeen: -1 })
                .limit(80)
                .lean()
        ]);
        const online = onlineUsers.map(u => ({
            username: u.username,
            pfp: u.pfp || "https://i.imgur.com/oJCfWc8.png",
            title: u.title || (u.username === "20k" ? "Owner" : "Member")
        }));
        res.json({ members, threads, posts, onlineCount: online.length, online });
    } catch (err) {
        res.json({ members: 0, threads: 0, posts: 0, onlineCount: 0, online: [] });
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
        res.json({ success: true, message: thread.pinned ? "📌 Pinned" : "📌 Unpinned" });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

app.get('/api/users/suggest', async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (!q || q.length < 1) return res.json([]);
        const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const users = await User.find({
            username: { $regex: '^' + escaped, $options: 'i' }
        }).limit(8).select('username pfp title');
        res.json(users.map(u => ({
            username: u.username,
            pfp: u.pfp || 'https://i.imgur.com/oJCfWc8.png',
            title: u.title || (u.username === '20k' ? 'Owner' : 'Member')
        })));
    } catch (err) {
        res.json([]);
    }
});

app.get('/api/users/suggest', async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (!q) return res.json([]);
        const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const users = await User.find({
            username: { $regex: '^' + escaped, $options: 'i' }
        }).limit(8).select('username pfp title');
        res.json(users.map(u => ({
            username: u.username,
            pfp: u.pfp || 'https://i.imgur.com/oJCfWc8.png',
            title: u.title || (u.username === '20k' ? 'Owner' : 'Member')
        })));
    } catch (e) {
        res.json([]);
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Running on http://localhost:${PORT}`);
});