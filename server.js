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
    .then(() => console.log("MongoDB connected"))
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
const Vote = require('./models/Vote');
const WatchedThread = require('./models/WatchedThread');
const Bookmark = require('./models/Bookmark');
const Poll = require('./models/Poll');
const PollVote = require('./models/PollVote');
const Conversation = require('./models/Conversation');
const ConversationMessage = require('./models/ConversationMessage');
const UserRank = require('./models/UserRank');
const Warning = require('./models/Warning');
const UserIgnore = require('./models/UserIgnore');
const UserActivity = require('./models/UserActivity');

const STAFF_TITLES = new Set(['owner', 'administrator', 'admin', 'moderator', 'mod', 'janitor']);

function isStaffTitle(title) {
    return STAFF_TITLES.has(String(title || '').toLowerCase());
}

async function canMod(username) {
    if (!username) return false;
    if (username === "20k") return true;
    const user = await User.findOne({ username });
    if (!user) return false;
    const t = (user.title || "").toLowerCase();
    return t === "owner" || t === "administrator" || t === "admin" || t === "moderator" || t === "mod";
}

async function canStaff(username) {
    if (!username) return false;
    if (username === "20k") return true;
    const user = await User.findOne({ username });
    if (!user) return false;
    const t = (user.title || "").toLowerCase();
    return STAFF_TITLES.has(t);
}

let cachedRanksConfig = null;
let cachedRanksAt = 0;

async function getRanksConfig() {
    if (cachedRanksConfig && Date.now() - cachedRanksAt < 30000) {
        return cachedRanksConfig;
    }
    let doc = await UserRank.findOne({ key: 'ranks_config' }).lean();
    if (!doc) {
        doc = await new UserRank({ key: 'ranks_config' }).save();
        doc = doc.toObject();
    }
    cachedRanksConfig = doc;
    cachedRanksAt = Date.now();
    return doc;
}

function computeRank(postCount, roleTitle, ranksList) {
    const r = String(roleTitle || 'Member').toLowerCase();
    if (r === 'owner' || r === 'administrator' || r === 'admin') {
        return { rankName: 'Owner', stars: 5 };
    }
    if (r === 'moderator' || r === 'mod') {
        return { rankName: 'Moderator', stars: 5 };
    }
    if (r === 'janitor') {
        return { rankName: 'Janitor', stars: 4 };
    }
    const list = Array.isArray(ranksList) && ranksList.length
        ? [...ranksList].sort((a, b) => (a.minPosts || 0) - (b.minPosts || 0))
        : [
            { name: 'Newcomer', minPosts: 0, stars: 1 },
            { name: 'Regular', minPosts: 10, stars: 2 },
            { name: 'Veteran', minPosts: 50, stars: 3 },
            { name: 'Established', minPosts: 150, stars: 4 },
            { name: 'Legend', minPosts: 500, stars: 5 }
        ];
    let chosen = list[0];
    for (const item of list) {
        if ((postCount || 0) >= (item.minPosts || 0)) {
            chosen = item;
        }
    }
    return {
        rankName: chosen ? chosen.name : 'Newcomer',
        stars: Math.min(5, Math.max(1, (chosen && chosen.stars) || 1))
    };
}

const lastActivityWriteMap = new Map();

async function recordActivity({ username, guestId, locationType, locationId }) {
    try {
        const now = Date.now();
        const actorKey = username ? `user:${username}` : (guestId ? `guest:${guestId}` : null);
        if (!actorKey) return;

        const locType = ['home', 'forum', 'thread', 'other'].includes(locationType) ? locationType : 'other';
        const locId = String(locationId || '').slice(0, 64);
        const prev = lastActivityWriteMap.get(actorKey);
        if (prev && prev.locType === locType && prev.locId === locId && (now - prev.at) < 12000) {
            return;
        }
        lastActivityWriteMap.set(actorKey, { locType, locId, at: now });

        let hideActivity = false;
        if (username) {
            const u = await User.collection.findOne({ username }, { projection: { hideActivity: 1 } });
            hideActivity = !!(u && u.hideActivity);
            await User.collection.updateOne(
                { username },
                { $set: { lastSeen: new Date() } }
            );
        }

        await UserActivity.updateOne(
            { actor_key: actorKey },
            {
                $set: {
                    actor_key: actorKey,
                    username: username || null,
                    is_guest: !username,
                    location_type: locType,
                    location_id: locId,
                    hide_activity: hideActivity,
                    updated_at: new Date()
                }
            },
            { upsert: true }
        );
    } catch (e) {}
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
    if (String(to_user).toLowerCase() === String(from_user).toLowerCase()) return;
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

async function notifyMentions(text, fromUser, options = {}) {
    if (!text || !fromUser) return Set ? new Set() : null;

    const context = options.context || 'post';
    const link = options.link || '/';
    const threadTitle = options.threadTitle || '';

    const mentionRegex = /@([a-zA-Z0-9_]{1,32})/g;
    const mentioned = new Set();
    let m;
    while ((m = mentionRegex.exec(String(text))) !== null) {
        mentioned.add(m[1]);
    }

    for (const name of mentioned) {
        if (name.toLowerCase() === String(fromUser).toLowerCase()) continue;

        const exists = await User.findOne({ username: name });
        if (!exists) continue;

        let message = fromUser + ' tagged you';
        if (context === 'post') message = fromUser + ' tagged you in this post';
        else if (context === 'd1sc') message = fromUser + ' tagged you in a d1sc';
        else if (context === 'announcement') message = fromUser + ' tagged you in an announcement';
        else if (context === 'banner') message = 'You are featured in the banner!';

        try {
            await createAlert({
                to_user: name,
                from_user: fromUser,
                type: 'mention',
                message,
                threadTitle,
                link
            });
        } catch (e) {}
    }
    return mentioned;
}

async function getThreadPollData(threadId, viewerUsername) {
    const poll = await Poll.findOne({ thread_id: String(threadId) }).lean();
    if (!poll) return null;
    const votes = await PollVote.find({ poll_id: poll.id }).lean();
    const totalVoters = votes.length;
    const counts = new Map();
    let totalVotes = 0;
    let userVotes = [];

    for (const opt of (poll.options || [])) {
        counts.set(String(opt.id), 0);
    }
    for (const v of votes) {
        if (viewerUsername && v.user_id === viewerUsername) {
            userVotes = Array.isArray(v.option_ids) ? v.option_ids.map(String) : [];
        }
        for (const oid of (v.option_ids || [])) {
            const key = String(oid);
            if (counts.has(key)) {
                counts.set(key, counts.get(key) + 1);
                totalVotes++;
            }
        }
    }

    const isClosed = !!(poll.closes_at && new Date() > new Date(poll.closes_at));
    const denom = poll.multiple_choice ? Math.max(1, totalVoters) : Math.max(1, totalVotes);

    const options = (poll.options || []).map(opt => {
        const c = counts.get(String(opt.id)) || 0;
        const pct = totalVoters > 0 ? Math.round((c / denom) * 1000) / 10 : 0;
        return {
            id: String(opt.id),
            text: opt.text,
            votes: c,
            percentage: pct
        };
    });

    return {
        id: poll.id,
        thread_id: poll.thread_id,
        question: poll.question,
        multiple_choice: !!poll.multiple_choice,
        allow_change: !!poll.allow_change,
        closes_at: poll.closes_at,
        isClosed,
        totalVoters,
        totalVotes,
        userVotes,
        options
    };
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
app.get('/members', (req, res) => res.sendFile(path.join(__dirname, 'public', 'members.html')));
app.get('/members.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'members.html')));
app.get('/inbox', (req, res) => res.sendFile(path.join(__dirname, 'public', 'inbox.html')));
app.get('/inbox.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'inbox.html')));
app.get('/watched.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'watched.html')));
app.get('/bookmarks.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'bookmarks.html')));

app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.json({ success: false, message: "Missing fields" });
        const cleanUser = String(username).trim();
        if (!/^[a-zA-Z0-9_]{2,24}$/.test(cleanUser)) {
            return res.json({ success: false, message: "Username must be 2-24 alphanumeric/underscore characters" });
        }
        const exists = await User.findOne({ username: cleanUser });
        if (exists) return res.json({ success: false, message: "User already exists" });
        await new User({ username: cleanUser, password, banned: false, tosAccepted: false, title: "Member", customTitle: "" }).save();
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
        if (user.banned) {
            if (user.banType === 'temporary' && user.banExpiresAt && new Date() > new Date(user.banExpiresAt)) {
                user.banned = false;
                user.banReason = "";
                user.banExpiresAt = null;
                await user.save();
            } else {
                return res.json({ success: false, message: "User is banned" });
            }
        }
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
        const forums = ['news', 'rules', 'b', 'serious', 'vent', 'int', 'brainrot', 'art', 'media', 'tech', 'nsfw', 'stories', 'qna', 'pit', 'srs', 'br', 'pol', 'crt', 'cnfs', 'ot'];
        const stats = {};
        const pfpCache = new Map();
        async function getPfp(uname) {
            if (!uname) return "https://i.imgur.com/oJCfWc8.png";
            if (pfpCache.has(uname)) return pfpCache.get(uname);
            const u = await User.collection.findOne({ username: uname });
            const url = (u && u.pfp) || "https://i.imgur.com/oJCfWc8.png";
            pfpCache.set(uname, url);
            return url;
        }
        for (const id of forums) {
            const threads = await Thread.find({ forum_id: id });
            const threadCount = threads.length;
            let postCount = 0;
            let last = null;
            if (threadCount > 0) {
                const threadIds = threads.map(t => t.id);
                postCount = await Post.countDocuments({ thread_id: { $in: threadIds } });
                const lastPost = await Post.findOne({ thread_id: { $in: threadIds } }).sort({ created_at: -1 });
                if (lastPost) {
                    const thread = threads.find(t => t.id === lastPost.thread_id);
                    last = {
                        title: thread ? thread.title : "Unknown",
                        prefix: thread ? (thread.prefix || "") : "",
                        user: lastPost.user_id,
                        pfp: await getPfp(lastPost.user_id),
                        at: lastPost.created_at,
                        threadId: lastPost.thread_id,
                        postId: lastPost.id
                    };
                } else {
                    const newest = [...threads].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
                    last = {
                        title: newest.title,
                        prefix: newest.prefix || "",
                        user: newest.user_id,
                        pfp: await getPfp(newest.user_id),
                        at: newest.created_at,
                        threadId: newest.id,
                        postId: ""
                    };
                }
            }
            stats[id] = { threads: threadCount, posts: postCount, last };
        }
        res.json(stats);
    } catch (err) {
        res.json({});
    }
});

app.get('/api/recent-posts', async (req, res) => {
    try {
        const recentPosts = await Post.find({}).sort({ created_at: -1 }).limit(18).lean();
        const threadIds = [...new Set(recentPosts.map(p => String(p.thread_id)))];
        const threads = threadIds.length ? await Thread.find({ id: { $in: threadIds } }).lean() : [];
        const threadMap = new Map(threads.map(t => [String(t.id), t]));
        const usernames = [...new Set([
            ...recentPosts.map(p => p.user_id),
            ...threads.map(t => t.user_id)
        ].filter(Boolean))];
        const users = usernames.length ? await User.find({ username: { $in: usernames } }).lean() : [];
        const userMap = new Map(users.map(u => [u.username, u]));
        const cutoff = Date.now() - 5 * 60 * 1000;
        const activeViewerCutoff = new Date(Date.now() - 3 * 60 * 1000);

        const activeActivities = threadIds.length
            ? await UserActivity.find({
                location_type: 'thread',
                location_id: { $in: threadIds },
                updated_at: { $gte: activeViewerCutoff }
            }).lean()
            : [];
        const viewersByThread = new Map();
        for (const act of activeActivities) {
            const tid = String(act.location_id);
            viewersByThread.set(tid, (viewersByThread.get(tid) || 0) + 1);
        }

        const postCounts = new Map();
        for (const tid of threadIds) {
            postCounts.set(tid, await Post.countDocuments({ thread_id: tid }));
        }

        const seenThreads = new Set();
        const items = [];
        for (const p of recentPosts) {
            const tid = String(p.thread_id);
            const t = threadMap.get(tid);
            if (!t || seenThreads.has(tid)) continue;
            seenThreads.add(tid);
            const u = userMap.get(p.user_id);
            const totalPosts = postCounts.get(tid) || 1;
            items.push({
                postId: p.id,
                threadId: t.id,
                title: t.title || "Untitled",
                prefix: t.prefix || "",
                hasPoll: !!t.hasPoll,
                forum_id: t.forum_id || "",
                creator: t.user_id || p.user_id || "Unknown",
                user: p.user_id || "Unknown",
                userRole: (u && u.title) || (p.user_id === "20k" ? "Owner" : "Member"),
                pfp: (u && u.pfp) || "https://i.imgur.com/oJCfWc8.png",
                online: !!(u && u.lastSeen && new Date(u.lastSeen).getTime() >= cutoff),
                replies: Math.max(0, totalPosts - 1),
                views: t.views || 0,
                viewers: viewersByThread.get(tid) || 0,
                at: p.created_at
            });
            if (items.length >= 6) break;
        }
        res.json(items);
    } catch (err) {
        res.json([]);
    }
});

app.get('/api/forums/:forumId/threads', async (req, res) => {
    try {
        const forumId = String(req.params.forumId);
        const threads = await Thread.find({ forum_id: forumId }).sort({ pinned: -1, created_at: -1 });
        const threadIds = threads.map(t => String(t.id));

        const polls = threadIds.length
            ? await Poll.find({ thread_id: { $in: threadIds } }).select('thread_id').lean()
            : [];
        const pollThreadSet = new Set(polls.map(p => String(p.thread_id)));

        const activeViewerCutoff = new Date(Date.now() - 3 * 60 * 1000);
        const activeActivities = threadIds.length
            ? await UserActivity.find({
                location_type: 'thread',
                location_id: { $in: threadIds },
                updated_at: { $gte: activeViewerCutoff }
            }).lean()
            : [];
        const viewersByThread = new Map();
        for (const act of activeActivities) {
            const tid = String(act.location_id);
            viewersByThread.set(tid, (viewersByThread.get(tid) || 0) + 1);
        }

        const userCache = new Map();
        async function getUserMeta(uname) {
            if (!uname) return { pfp: "https://i.imgur.com/oJCfWc8.png", role: "Member" };
            if (userCache.has(uname)) return userCache.get(uname);
            const u = await User.findOne({ username: uname }).select('pfp title').lean();
            const meta = {
                pfp: (u && u.pfp) || "https://i.imgur.com/oJCfWc8.png",
                role: (u && u.title) || (uname === "20k" ? "Owner" : "Member")
            };
            userCache.set(uname, meta);
            return meta;
        }
        const result = [];
        for (const thread of threads) {
            const posts = await Post.find({ thread_id: thread.id });
            const creatorMeta = await getUserMeta(thread.user_id);
            let lastPost = null;
            if (posts.length > 0) {
                const latest = posts.reduce((a, b) => new Date(b.created_at) > new Date(a.created_at) ? b : a, posts[0]);
                const lastMeta = await getUserMeta(latest.user_id);
                lastPost = {
                    id: latest.id,
                    user: latest.user_id,
                    pfp: lastMeta.pfp,
                    role: lastMeta.role,
                    at: latest.created_at
                };
            }
            result.push({
                ...thread.toObject(),
                creatorPfp: creatorMeta.pfp,
                creatorRole: creatorMeta.role,
                postCount: posts.length,
                repliesCount: Math.max(0, posts.length - 1),
                views: thread.views || 0,
                viewers: viewersByThread.get(String(thread.id)) || 0,
                locked: !!thread.locked,
                pinned: !!thread.pinned,
                hasPoll: !!(thread.hasPoll || pollThreadSet.has(String(thread.id))),
                prefix: thread.prefix || "",
                lastPost
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
        if (!content || !String(content).trim()) {
            return res.json({ success: false, message: "Empty announcement" });
        }

        await new Announcement({
            id: Date.now().toString(36),
            content: content.trim(),
            author: "20k",
            pinned: false,
            created_at: new Date()
        }).save();

        await notifyMentions(content, '20k', {
            context: 'announcement',
            link: '/',
            threadTitle: 'Announcement'
        });

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
        res.json({ success: true, message: ann.pinned ? "Announcement pinned!" : "Announcement unpinned!" });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

app.post('/api/admin/banner', async (req, res) => {
    try {
        const { username, text, imageUrl } = req.body;
        if (username !== "20k") return res.json({ success: false, message: "No permission" });

        await GlobalBanner.findOneAndUpdate(
            { active: true },
            { active: !!(text || imageUrl), text: text || "", imageUrl: imageUrl || "" },
            { upsert: true }
        );

        if (text && String(text).trim()) {
            await notifyMentions(text, '20k', {
                context: 'banner',
                link: '/',
                threadTitle: 'Global banner'
            });
        }

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
        if (!thread) {
            return res.json({ success: false, title: "Thread not found", creator: "Unknown" });
        }

        const viewer = String(req.query.username || '').trim();

        if (viewer) {
            const already = Array.isArray(thread.viewedBy) && thread.viewedBy.includes(viewer);
            if (!already) {
                await Thread.updateOne(
                    { id: thread.id, viewedBy: { $ne: viewer } },
                    {
                        $inc: { views: 1 },
                        $addToSet: { viewedBy: viewer }
                    }
                );
                thread.views = (thread.views || 0) + 1;
            }
        }

        const watching = viewer
            ? !!(await WatchedThread.findOne({ user_id: viewer, thread_id: String(thread.id) }).lean())
            : false;

        const poll = await getThreadPollData(thread.id, viewer);

        res.json({
            success: true,
            id: thread.id,
            title: thread.title,
            forum_id: thread.forum_id || "",
            creator: thread.user_id,
            created_at: thread.created_at,
            views: thread.views || 0,
            locked: !!thread.locked,
            pinned: !!thread.pinned,
            prefix: thread.prefix || "",
            watching,
            poll
        });
    } catch (err) {
        res.json({ success: false, title: "Thread not found", creator: "Unknown" });
    }
});

app.post('/api/posts', async (req, res) => {
    try {
        const { content, thread_id, username, fileUrl, fileUrls, parent_id } = req.body;
        if (!thread_id || !username) {
            return res.json({ success: false, message: "Missing required fields" });
        }

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
        pingUser(username);

        const thread = threadCheck || await Thread.findOne({ id: String(thread_id) });
        const tTitle = (thread && thread.title) || '';
        const tLink = '/thread.html?id=' + encodeURIComponent(thread_id) +
            '&title=' + encodeURIComponent(tTitle);

        const notifiedUsers = new Set([String(username).toLowerCase()]);

        // Thread owner alert
        try {
            if (thread && thread.user_id && String(thread.user_id).toLowerCase() !== String(username).toLowerCase()) {
                await createAlert({
                    to_user: thread.user_id,
                    from_user: username,
                    type: "thread_reply",
                    message: username + ' replied in your d1sc',
                    threadTitle: tTitle || 'Untitled',
                    link: tLink + '#post-' + post.id
                });
                notifiedUsers.add(String(thread.user_id).toLowerCase());
            }
        } catch (e) {}

        // Nested reply alert
        try {
            if (parent_id) {
                const parent = await Post.findOne({ id: String(parent_id) });
                if (parent && parent.user_id && !notifiedUsers.has(String(parent.user_id).toLowerCase())) {
                    await createAlert({
                        to_user: parent.user_id,
                        from_user: username,
                        type: "reply",
                        message: username + ' replied to your post',
                        threadTitle: tTitle,
                        link: tLink + '#post-' + post.id
                    });
                    notifiedUsers.add(String(parent.user_id).toLowerCase());
                }
            }
        } catch (e) {}

        // @mentions
        const mentionedSet = await notifyMentions(content || '', username, {
            context: 'post',
            link: tLink + '#post-' + post.id,
            threadTitle: tTitle
        });
        if (mentionedSet) {
            for (const mName of mentionedSet) {
                notifiedUsers.add(String(mName).toLowerCase());
            }
        }

        // Watched thread subscribers
        try {
            const watchers = await WatchedThread.find({ thread_id: String(thread_id) }).lean();
            for (const w of watchers) {
                if (w.user_id && !notifiedUsers.has(String(w.user_id).toLowerCase())) {
                    await createAlert({
                        to_user: w.user_id,
                        from_user: username,
                        type: "watched_thread",
                        message: username + ' replied to watched thread "' + (tTitle || 'Untitled') + '"',
                        threadTitle: tTitle || 'Untitled',
                        link: tLink + '#post-' + post.id
                    });
                    notifiedUsers.add(String(w.user_id).toLowerCase());
                }
            }
        } catch (e) {}

        res.json({ success: true, message: parent_id ? "Reply posted!" : "Post created!", postId: post.id });
    } catch (err) {
        console.error('POST /api/posts error:', err);
        res.json({ success: false, message: "Server error" });
    }
});

app.get('/api/threads/:threadId/posts', async (req, res) => {
    try {
        const viewer = String(req.query.username || '').trim();
        const posts = await Post.find({ thread_id: String(req.params.threadId) }).sort({ created_at: 1 });
        const postIds = posts.map(p => String(p.id));
        const allVotes = postIds.length
            ? await Vote.find({ target_type: 'post', target_id: { $in: postIds } }).lean()
            : [];
        const votesByPost = new Map();
        for (const v of allVotes) {
            const key = String(v.target_id);
            if (!votesByPost.has(key)) votesByPost.set(key, []);
            votesByPost.get(key).push({
                user_id: v.user_id,
                reaction: v.reaction || 'like'
            });
        }

        const bookmarkedPostIds = new Set();
        if (viewer && postIds.length) {
            const bms = await Bookmark.find({ user_id: viewer, post_id: { $in: postIds } }).select('post_id').lean();
            for (const bm of bms) bookmarkedPostIds.add(String(bm.post_id));
        }

        const ranksCfg = await getRanksConfig();
        const userCache = new Map();
        const onlineCutoff = Date.now() - 5 * 60 * 1000;
        async function getAuthorMeta(uname) {
            if (userCache.has(uname)) return userCache.get(uname);
            const user = await User.collection.findOne({ username: uname });
            const postCount = await Post.countDocuments({ user_id: uname });
            const userPosts = await Post.find({ user_id: uname }).select('id').lean();
            const uPostIds = userPosts.map(up => String(up.id));
            const reactionScore = uPostIds.length
                ? await Vote.countDocuments({ target_type: 'post', target_id: { $in: uPostIds } })
                : 0;
            let title = (user && user.title) || "Member";
            if (uname === "20k" && (!user || !user.title || user.title === "Member")) title = "Owner";
            const customTitle = (user && user.customTitle) || "";
            const rankInfo = computeRank(postCount, title, ranksCfg.ranks);
            const online = !!(user && !user.hideActivity && user.lastSeen && new Date(user.lastSeen).getTime() >= onlineCutoff);
            const meta = {
                pfp: (user && user.pfp) || "https://i.imgur.com/oJCfWc8.png",
                title,
                customTitle,
                rankName: rankInfo.rankName,
                stars: rankInfo.stars,
                joined: user ? user.created_at : null,
                postCount,
                reactionScore,
                signature: (user && user.signature) || "",
                online,
                isStaff: isStaffTitle(title) || uname === '20k'
            };
            userCache.set(uname, meta);
            return meta;
        }

        const cleaned = [];
        for (const p of posts) {
            const meta = await getAuthorMeta(p.user_id);
            cleaned.push({
                id: String(p.id),
                content: p.content || "",
                thread_id: String(p.thread_id),
                user_id: p.user_id,
                pfp: meta.pfp,
                userTitle: meta.title,
                userCustomTitle: meta.customTitle,
                userRank: meta.rankName,
                userStars: meta.stars,
                userIsStaff: meta.isStaff,
                userJoined: meta.joined,
                userPostCount: meta.postCount,
                userReactions: meta.reactionScore,
                userSignature: meta.signature,
                userOnline: meta.online,
                fileUrl: p.fileUrl,
                fileUrls: p.fileUrls || (p.fileUrl ? [p.fileUrl] : []),
                parent_id: p.parent_id ? String(p.parent_id) : null,
                created_at: p.created_at,
                edited_at: p.edited_at || null,
                bookmarked: bookmarkedPostIds.has(String(p.id)),
                reactions: votesByPost.get(String(p.id)) || [],
                replies: []
            });
        }
        const map = new Map();
        cleaned.forEach(p => map.set(p.id, p));
        cleaned.forEach(p => {
            if (p.parent_id && map.has(p.parent_id)) {
                const parent = map.get(p.parent_id);
                p.replyTo = {
                    id: parent.id,
                    user_id: parent.user_id,
                    content: parent.content,
                    fileUrls: parent.fileUrls
                };
            }
        });
        res.json(cleaned);
    } catch (err) {
        res.json([]);
    }
});

app.post('/api/threads', async (req, res) => {
    try {
        const { title, content, forum_id, username, fileUrl, fileUrls, prefix, pinned, locked, poll } = req.body;

        if (!title || !forum_id || !username) {
            return res.json({ success: false, message: "Missing fields" });
        }

        if (String(forum_id) === "news") {
            if (!(await canStaff(username))) {
                return res.json({
                    success: false,
                    message: "Only Owner, Moderator, and Janitor can post in News & Announcements"
                });
            }
        }

        // Validate poll if provided
        let validPoll = null;
        if (poll && poll.question && String(poll.question).trim()) {
            const rawOpts = Array.isArray(poll.options)
                ? poll.options.map(o => String(o || '').trim()).filter(Boolean)
                : [];
            if (rawOpts.length < 2 || rawOpts.length > 6) {
                return res.json({ success: false, message: "Polls must have between 2 and 6 answer choices" });
            }
            let closesAt = null;
            if (poll.closes_at) {
                const parsed = new Date(poll.closes_at);
                if (!isNaN(parsed.getTime())) closesAt = parsed;
            }
            validPoll = {
                question: String(poll.question).trim().slice(0, 200),
                options: rawOpts.map((text, idx) => ({ id: 'opt_' + (idx + 1), text: text.slice(0, 120) })),
                multiple_choice: !!poll.multiple_choice,
                allow_change: !!poll.allow_change,
                closes_at: closesAt
            };
        }

        const isMod = await canMod(username);
        const threadId = Date.now().toString(36);
        const thread = new Thread({
            id: threadId,
            title: String(title).trim(),
            forum_id: String(forum_id),
            user_id: username,
            prefix: (prefix || "").trim().slice(0, 32),
            pinned: isMod ? !!pinned : false,
            locked: isMod ? !!locked : false,
            hasPoll: !!validPoll,
            views: 0,
            created_at: new Date()
        });
        await thread.save();

        if (validPoll) {
            await new Poll({
                id: 'poll_' + threadId,
                thread_id: threadId,
                question: validPoll.question,
                options: validPoll.options,
                multiple_choice: validPoll.multiple_choice,
                allow_change: validPoll.allow_change,
                closes_at: validPoll.closes_at,
                created_at: new Date()
            }).save();
        }

        const allFiles = Array.isArray(fileUrls) ? fileUrls : (fileUrl ? [fileUrl] : []);
        await new Post({
            id: threadId + "p",
            thread_id: thread.id,
            user_id: username,
            content: content ? content.trim() : "",
            fileUrl: allFiles[0] || null,
            fileUrls: allFiles,
            parent_id: null,
            created_at: new Date()
        }).save();

        // Automatically watch own created thread
        try {
            await WatchedThread.updateOne(
                { user_id: username, thread_id: thread.id },
                { $setOnInsert: { user_id: username, thread_id: thread.id, created_at: new Date() } },
                { upsert: true }
            );
        } catch (e) {}

        await notifyMentions(content || '', username, {
            context: 'd1sc',
            link: '/thread.html?id=' + encodeURIComponent(thread.id) +
                '&title=' + encodeURIComponent(title || ''),
            threadTitle: title || ''
        });

        res.json({ success: true, message: "Thread created successfully!", threadId: thread.id });
    } catch (err) {
        console.error("Error creating thread:", err);
        res.json({ success: false, message: "Server error creating thread" });
    }
});

// Poll Voting
app.post('/api/threads/:threadId/poll/vote', async (req, res) => {
    try {
        const { username, optionIds } = req.body;
        if (!username) return res.json({ success: false, message: "Login required to vote" });
        const threadId = String(req.params.threadId);
        const poll = await Poll.findOne({ thread_id: threadId });
        if (!poll) return res.json({ success: false, message: "Poll not found" });

        if (poll.closes_at && new Date() > new Date(poll.closes_at)) {
            return res.json({ success: false, message: "This poll has closed" });
        }

        const validOptionIds = new Set((poll.options || []).map(o => String(o.id)));
        const selected = (Array.isArray(optionIds) ? optionIds : [optionIds])
            .map(String)
            .filter(id => validOptionIds.has(id));
        const uniqueSelected = [...new Set(selected)];

        if (!uniqueSelected.length) {
            return res.json({ success: false, message: "Select at least one option" });
        }
        if (!poll.multiple_choice && uniqueSelected.length > 1) {
            return res.json({ success: false, message: "Only one option may be selected" });
        }

        const existingVote = await PollVote.findOne({ poll_id: poll.id, user_id: username });
        if (existingVote && !poll.allow_change) {
            return res.json({ success: false, message: "You have already voted in this poll" });
        }

        await PollVote.updateOne(
            { poll_id: poll.id, user_id: username },
            {
                $set: {
                    poll_id: poll.id,
                    thread_id: threadId,
                    user_id: username,
                    option_ids: uniqueSelected,
                    created_at: new Date()
                }
            },
            { upsert: true }
        );

        const updatedPoll = await getThreadPollData(threadId, username);
        res.json({ success: true, message: "Vote recorded", poll: updatedPoll });
    } catch (err) {
        res.json({ success: false, message: "Server error recording vote" });
    }
});

// Watched Threads Endpoints
app.post('/api/threads/:threadId/watch', async (req, res) => {
    try {
        const { username } = req.body;
        if (!username) return res.json({ success: false, message: "Login required" });
        const threadId = String(req.params.threadId);
        const thread = await Thread.findOne({ id: threadId });
        if (!thread) return res.json({ success: false, message: "Thread not found" });

        const existing = await WatchedThread.findOne({ user_id: username, thread_id: threadId });
        if (existing) {
            await WatchedThread.deleteOne({ _id: existing._id });
            return res.json({ success: true, watching: false, message: "Thread unwatched" });
        } else {
            await new WatchedThread({ user_id: username, thread_id: threadId, created_at: new Date() }).save();
            return res.json({ success: true, watching: true, message: "Watching thread" });
        }
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

app.get(['/api/watched', '/api/watched-threads'], async (req, res) => {
    try {
        const username = String(req.query.username || '').trim();
        if (!username) return res.json([]);
        const watched = await WatchedThread.find({ user_id: username }).sort({ created_at: -1 }).lean();
        const threadIds = watched.map(w => String(w.thread_id));
        if (!threadIds.length) return res.json([]);

        const threads = await Thread.find({ id: { $in: threadIds } }).lean();
        const threadMap = new Map(threads.map(t => [String(t.id), t]));
        const creatorNames = [...new Set(threads.map(t => t.user_id).filter(Boolean))];
        const creators = creatorNames.length
            ? await User.find({ username: { $in: creatorNames } }).select('username pfp').lean()
            : [];
        const creatorMap = new Map(creators.map(u => [u.username, u.pfp]));
        const result = [];

        for (const w of watched) {
            const t = threadMap.get(String(w.thread_id));
            if (!t) continue;
            const postCount = await Post.countDocuments({ thread_id: t.id });
            const lastPost = await Post.findOne({ thread_id: t.id }).sort({ created_at: -1 }).lean();
            result.push({
                id: t.id,
                title: t.title,
                prefix: t.prefix || "",
                forum_id: t.forum_id || "b",
                user_id: t.user_id,
                creatorPfp: creatorMap.get(t.user_id) || "https://i.imgur.com/oJCfWc8.png",
                created_at: t.created_at,
                views: t.views || 0,
                repliesCount: Math.max(0, postCount - 1),
                locked: !!t.locked,
                pinned: !!t.pinned,
                hasPoll: !!t.hasPoll,
                lastPost: lastPost ? {
                    id: lastPost.id,
                    user: lastPost.user_id,
                    at: lastPost.created_at
                } : null
            });
        }
        res.json(result);
    } catch (err) {
        res.json([]);
    }
});

// Bookmarks Endpoints
app.post('/api/posts/:postId/bookmark', async (req, res) => {
    try {
        const { username, note } = req.body;
        if (!username) return res.json({ success: false, message: "Login required" });
        const postId = String(req.params.postId);
        const post = await Post.findOne({ id: postId });
        if (!post) return res.json({ success: false, message: "Post not found" });

        const existing = await Bookmark.findOne({ user_id: username, post_id: postId });
        if (existing) {
            await Bookmark.deleteOne({ _id: existing._id });
            return res.json({ success: true, bookmarked: false, message: "Bookmark removed" });
        } else {
            await new Bookmark({
                id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                user_id: username,
                post_id: postId,
                thread_id: String(post.thread_id),
                note: String(note || "").trim().slice(0, 160),
                created_at: new Date()
            }).save();
            return res.json({ success: true, bookmarked: true, message: "Bookmark saved" });
        }
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

app.get('/api/bookmarks', async (req, res) => {
    try {
        const username = String(req.query.username || '').trim();
        if (!username) return res.json([]);
        const bms = await Bookmark.find({ user_id: username }).sort({ created_at: -1 }).lean();
        if (!bms.length) return res.json([]);

        const postIds = bms.map(b => String(b.post_id));
        const threadIds = [...new Set(bms.map(b => String(b.thread_id)))];
        const [posts, threads] = await Promise.all([
            Post.find({ id: { $in: postIds } }).lean(),
            Thread.find({ id: { $in: threadIds } }).lean()
        ]);
        const postMap = new Map(posts.map(p => [String(p.id), p]));
        const threadMap = new Map(threads.map(t => [String(t.id), t]));

        const result = [];
        for (const b of bms) {
            const p = postMap.get(String(b.post_id));
            if (!p) continue;
            const t = threadMap.get(String(b.thread_id));
            const author = await User.findOne({ username: p.user_id }).select('pfp title').lean();
            result.push({
                id: b.id,
                post_id: p.id,
                thread_id: p.thread_id,
                thread_title: t ? t.title : "Deleted Thread",
                thread_prefix: t ? (t.prefix || "") : "",
                author: p.user_id,
                author_pfp: (author && author.pfp) || "https://i.imgur.com/oJCfWc8.png",
                author_role: (author && author.title) || (p.user_id === "20k" ? "Owner" : "Member"),
                content: p.content || "",
                note: b.note || "",
                post_created_at: p.created_at,
                bookmarked_at: b.created_at,
                link: `/thread.html?id=${encodeURIComponent(p.thread_id)}#post-${encodeURIComponent(p.id)}`
            });
        }
        res.json(result);
    } catch (err) {
        res.json([]);
    }
});

app.delete('/api/bookmarks/:postId', async (req, res) => {
    try {
        const { username } = req.body;
        if (!username) return res.json({ success: false, message: "Login required" });
        await Bookmark.deleteOne({ user_id: username, post_id: String(req.params.postId) });
        res.json({ success: true, message: "Bookmark removed" });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
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
            message: thread.locked ? "Thread locked" : "Thread unlocked"
        });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

app.post('/api/profile/update', async (req, res) => {
    try {
        const { username, bio, signature, pfp, banner, customTitle, hideActivity } = req.body;
        if (!username) return res.json({ success: false, message: "Missing username" });
        const $set = {};
        if (typeof bio === "string") $set.bio = bio;
        if (typeof signature === "string") $set.signature = signature.slice(0, 600);
        if (typeof pfp === "string" && pfp) $set.pfp = pfp;
        if (typeof banner === "string" && banner) $set.banner = banner;
        if (typeof hideActivity === "boolean") $set.hideActivity = hideActivity;
        if (typeof customTitle === "string") {
            const cleanCustom = customTitle.trim().slice(0, 40);
            const isCallerStaff = await canStaff(username);
            if (!isCallerStaff && isStaffTitle(cleanCustom)) {
                return res.json({ success: false, message: "Cannot use reserved staff titles" });
            }
            $set.customTitle = cleanCustom;
        }
        if (!Object.keys($set).length) return res.json({ success: false, message: "Nothing to update" });
        await User.collection.updateOne({ username }, { $set });
        const user = await User.collection.findOne({ username });
        if (!user) return res.json({ success: false, message: "User not found" });
        res.json({
            success: true,
            message: "Profile updated!",
            pfp: user.pfp || "",
            banner: user.banner || "",
            bio: user.bio || "",
            signature: user.signature || "",
            customTitle: user.customTitle || "",
            hideActivity: !!user.hideActivity
        });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

app.get('/api/profile/:username', async (req, res) => {
    try {
        const user = await User.collection.findOne({ username: req.params.username });
        if (!user) return res.json({ success: false, message: "User not found" });

        const viewer = String(req.query.viewer || '').trim();
        const postCount = await Post.countDocuments({ user_id: user.username });
        const userPosts = await Post.find({ user_id: user.username }).select('id').lean();
        const uPostIds = userPosts.map(up => String(up.id));
        const reactionScore = uPostIds.length
            ? await Vote.countDocuments({ target_type: 'post', target_id: { $in: uPostIds } })
            : 0;
        let title = user.title || "Member";
        if (user.username === "20k" && (!user.title || user.title === "Member")) title = "Owner";
        const ranksCfg = await getRanksConfig();
        const rankInfo = computeRank(postCount, title, ranksCfg.ranks);
        const online = !!(user.lastSeen && !user.hideActivity && (Date.now() - new Date(user.lastSeen).getTime() < 5 * 60 * 1000));

        let isIgnored = false;
        if (viewer && viewer !== user.username) {
            isIgnored = !!(await UserIgnore.findOne({ user_id: viewer, ignored_user_id: user.username }).lean());
        }

        // Active non-expired warning points
        const now = new Date();
        const activeWarnings = await Warning.find({
            user_id: user.username,
            active: true,
            $or: [{ expires_at: null }, { expires_at: { $gt: now } }]
        }).lean();
        const warningPoints = activeWarnings.reduce((sum, w) => sum + (w.points || 0), 0);

        res.json({
            success: true,
            username: user.username,
            pfp: user.pfp || "https://i.imgur.com/oJCfWc8.png",
            banner: user.banner || "",
            bio: user.bio || "No bio yet.",
            signature: user.signature || "",
            title,
            customTitle: user.customTitle || "",
            rankName: rankInfo.rankName,
            stars: rankInfo.stars,
            isStaff: isStaffTitle(title) || user.username === '20k',
            hideActivity: !!user.hideActivity,
            postCount,
            reactionScore,
            warningPoints,
            isIgnored,
            online,
            lastSeen: user.hideActivity ? null : (user.lastSeen || null),
            created_at: user.created_at,
            banned: !!user.banned,
            banReason: user.banReason || '',
            banType: user.banType || 'permanent'
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
            message: username + ' commented on your profile',
            threadTitle: "",
            link: '/profile.html?user=' + encodeURIComponent(req.params.username)
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
                url: '/thread.html?id=' + t.id + '&title=' + encodeURIComponent(t.title || "")
            });
        }
        for (const p of posts) {
            const thread = await Thread.findOne({ id: p.thread_id });
            if (!p.parent_id && String(p.id).endsWith("p") && thread && thread.user_id === name) continue;
            const title = thread ? thread.title : "Unknown thread";
            activity.push({
                type: "comment",
                id: p.id,
                thread_id: p.thread_id,
                title,
                preview: (p.content || "").slice(0, 140),
                created_at: p.created_at,
                url: '/thread.html?id=' + p.thread_id + '&title=' + encodeURIComponent(title) + '#post-' + p.id
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
        const unreadInbox = await Conversation.countDocuments({
            participants: req.params.username,
            unread_by: req.params.username
        });
        res.json({ alerts, unread, unreadInbox });
    } catch (err) {
        res.json({ alerts: [], unread: 0, unreadInbox: 0 });
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

// Private Conversations / Inbox API
app.get(['/api/conversations', '/api/inbox'], async (req, res) => {
    try {
        const username = String(req.query.username || '').trim();
        if (!username) return res.json(req.path.startsWith('/api/conversations') ? [] : { success: false, conversations: [], unreadCount: 0 });

        const convs = await Conversation.find({ participants: username })
            .sort({ last_message_at: -1 })
            .lean();

        const pSet = new Set();
        for (const c of convs) {
            for (const p of (c.all_participants || c.participants || [])) pSet.add(p);
        }
        const users = pSet.size ? await User.find({ username: { $in: [...pSet] } }).select('username pfp title').lean() : [];
        const userMap = new Map(users.map(u => [u.username, u]));

        const list = [];
        let unreadCount = 0;
        for (const c of convs) {
            const msgCount = await ConversationMessage.countDocuments({ conversation_id: c.id });
            const isUnread = Array.isArray(c.unread_by) && c.unread_by.includes(username);
            if (isUnread) unreadCount++;
            const parts = (c.all_participants && c.all_participants.length ? c.all_participants : c.participants).map(uname => {
                const u = userMap.get(uname);
                return {
                    username: uname,
                    pfp: (u && u.pfp) || "https://i.imgur.com/oJCfWc8.png",
                    title: (u && u.title) || (uname === "20k" ? "Owner" : "Member"),
                    active: (c.participants || []).includes(uname)
                };
            });
            list.push({
                id: c.id,
                title: c.title,
                creator: c.creator,
                participants: parts,
                messageCount: msgCount,
                repliesCount: Math.max(0, msgCount - 1),
                unread: isUnread,
                last_message_at: c.last_message_at,
                last_message_by: c.last_message_by || c.creator,
                created_at: c.created_at
            });
        }
        if (req.path === '/api/conversations' && !req.query.wrap) {
            return res.json(list);
        }
        res.json({ success: true, conversations: list, unreadCount });
    } catch (err) {
        if (req.path === '/api/conversations' && !req.query.wrap) {
            return res.json([]);
        }
        res.json({ success: false, conversations: [], unreadCount: 0 });
    }
});

app.post(['/api/conversations', '/api/inbox'], async (req, res) => {
    try {
        const { username, recipient, title, content } = req.body;
        if (!username || !recipient || !title || !content) {
            return res.json({ success: false, message: "All fields are required" });
        }
        const cleanRecipient = String(recipient).trim();
        const cleanTitle = String(title).trim().slice(0, 140);
        const cleanContent = String(content).trim();
        if (!cleanTitle || !cleanContent) {
            return res.json({ success: false, message: "Title and message cannot be empty" });
        }
        if (cleanRecipient.toLowerCase() === String(username).toLowerCase()) {
            return res.json({ success: false, message: "You cannot start a conversation with yourself" });
        }
        const targetUser = await User.findOne({ username: cleanRecipient });
        if (!targetUser) {
            return res.json({ success: false, message: "Recipient user not found" });
        }

        // Check if recipient ignores sender (unless sender is staff)
        const senderStaff = await canStaff(username);
        if (!senderStaff) {
            const ignored = await UserIgnore.findOne({ user_id: targetUser.username, ignored_user_id: username });
            if (ignored) {
                return res.json({ success: false, message: "You cannot message this user" });
            }
        }

        const convId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const participants = [username, targetUser.username];
        await new Conversation({
            id: convId,
            title: cleanTitle,
            creator: username,
            participants,
            all_participants: participants,
            unread_by: [targetUser.username],
            last_message_at: new Date(),
            last_message_by: username,
            created_at: new Date()
        }).save();

        await new ConversationMessage({
            id: convId + '_m1',
            conversation_id: convId,
            sender: username,
            content: cleanContent,
            created_at: new Date()
        }).save();

        await createAlert({
            to_user: targetUser.username,
            from_user: username,
            type: 'conversation',
            message: username + ' started a private conversation with you: "' + cleanTitle + '"',
            threadTitle: cleanTitle,
            link: '/inbox.html?id=' + encodeURIComponent(convId)
        });

        res.json({ success: true, conversationId: convId, message: "Conversation started" });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

app.get(['/api/conversations/:id', '/api/inbox/:id'], async (req, res) => {
    try {
        const username = String(req.query.username || '').trim();
        if (!username) return res.status(403).json({ success: false, message: "Login required" });

        const conv = await Conversation.findOne({ id: String(req.params.id) });
        if (!conv || !(conv.participants || []).includes(username)) {
            return res.status(403).json({ success: false, message: "Access denied to this conversation" });
        }

        if ((conv.unread_by || []).includes(username)) {
            conv.unread_by = conv.unread_by.filter(u => u !== username);
            await conv.save();
        }

        const messages = await ConversationMessage.find({ conversation_id: conv.id }).sort({ created_at: 1 }).lean();
        const ranksCfg = await getRanksConfig();
        const onlineCutoff = Date.now() - 5 * 60 * 1000;
        const userCache = new Map();

        async function getAuthorMeta(uname) {
            if (userCache.has(uname)) return userCache.get(uname);
            const u = await User.collection.findOne({ username: uname });
            const postCount = await Post.countDocuments({ user_id: uname });
            let title = (u && u.title) || "Member";
            if (uname === "20k" && (!u || !u.title || u.title === "Member")) title = "Owner";
            const rankInfo = computeRank(postCount, title, ranksCfg.ranks);
            const meta = {
                username: uname,
                pfp: (u && u.pfp) || "https://i.imgur.com/oJCfWc8.png",
                title,
                customTitle: (u && u.customTitle) || "",
                rankName: rankInfo.rankName,
                stars: rankInfo.stars,
                postCount,
                joined: u ? u.created_at : null,
                online: !!(u && !u.hideActivity && u.lastSeen && new Date(u.lastSeen).getTime() >= onlineCutoff)
            };
            userCache.set(uname, meta);
            return meta;
        }

        const enrichedMessages = [];
        for (const m of messages) {
            const meta = await getAuthorMeta(m.sender);
            enrichedMessages.push({
                id: m.id,
                sender: m.sender,
                content: m.content,
                created_at: m.created_at,
                author: meta
            });
        }

        const participantMetas = [];
        for (const p of (conv.all_participants && conv.all_participants.length ? conv.all_participants : conv.participants)) {
            const meta = await getAuthorMeta(p);
            participantMetas.push({
                ...meta,
                active: (conv.participants || []).includes(p)
            });
        }

        res.json({
            success: true,
            conversation: {
                id: conv.id,
                title: conv.title,
                creator: conv.creator,
                participants: participantMetas,
                created_at: conv.created_at
            },
            messages: enrichedMessages
        });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

app.post(['/api/conversations/:id/messages', '/api/inbox/:id/messages'], async (req, res) => {
    try {
        const { username, content } = req.body;
        if (!username || !content || !String(content).trim()) {
            return res.json({ success: false, message: "Message cannot be empty" });
        }
        const conv = await Conversation.findOne({ id: String(req.params.id) });
        if (!conv || !(conv.participants || []).includes(username)) {
            return res.status(403).json({ success: false, message: "Access denied" });
        }

        const msgId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        await new ConversationMessage({
            id: msgId,
            conversation_id: conv.id,
            sender: username,
            content: String(content).trim(),
            created_at: new Date()
        }).save();

        const otherParticipants = (conv.participants || []).filter(p => p !== username);
        conv.last_message_at = new Date();
        conv.last_message_by = username;
        conv.unread_by = [...new Set([...(conv.unread_by || []).filter(u => u !== username), ...otherParticipants])];
        await conv.save();

        for (const other of otherParticipants) {
            await createAlert({
                to_user: other,
                from_user: username,
                type: 'conversation',
                message: username + ' replied in conversation "' + conv.title + '"',
                threadTitle: conv.title,
                link: '/inbox.html?id=' + encodeURIComponent(conv.id)
            });
        }

        res.json({ success: true, message: "Reply sent" });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

app.post(['/api/conversations/:id/leave', '/api/inbox/:id/leave'], async (req, res) => {
    try {
        const { username } = req.body;
        if (!username) return res.json({ success: false, message: "Login required" });
        const conv = await Conversation.findOne({ id: String(req.params.id) });
        if (!conv || !(conv.participants || []).includes(username)) {
            return res.json({ success: false, message: "Conversation not found" });
        }
        conv.participants = (conv.participants || []).filter(p => p !== username);
        conv.unread_by = (conv.unread_by || []).filter(p => p !== username);
        await conv.save();
        res.json({ success: true, message: "You have left the conversation" });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

// Ranks & Custom Titles Configuration
app.get('/api/ranks', async (req, res) => {
    try {
        const cfg = await getRanksConfig();
        res.json({
            success: true,
            ranks: cfg.ranks || [],
            warningThresholdTempBan: cfg.warningThresholdTempBan || 10,
            warningThresholdPermBan: cfg.warningThresholdPermBan || 20
        });
    } catch (err) {
        res.json({ success: false, ranks: [] });
    }
});

app.post('/api/admin/ranks', async (req, res) => {
    try {
        const { admin, ranks, warningThresholdTempBan, warningThresholdPermBan } = req.body;
        if (!(await canMod(admin))) return res.json({ success: false, message: "No permission" });

        const update = { updated_at: new Date() };
        if (Array.isArray(ranks) && ranks.length) {
            update.ranks = ranks.map(r => ({
                name: String(r.name || 'Rank').trim().slice(0, 32),
                minPosts: Math.max(0, parseInt(r.minPosts, 10) || 0),
                stars: Math.min(5, Math.max(1, parseInt(r.stars, 10) || 1))
            })).sort((a, b) => a.minPosts - b.minPosts);
        }
        if (warningThresholdTempBan !== undefined) {
            update.warningThresholdTempBan = Math.max(1, parseInt(warningThresholdTempBan, 10) || 10);
        }
        if (warningThresholdPermBan !== undefined) {
            update.warningThresholdPermBan = Math.max(1, parseInt(warningThresholdPermBan, 10) || 20);
        }

        await UserRank.findOneAndUpdate({ key: 'ranks_config' }, { $set: update }, { upsert: true });
        cachedRanksConfig = null;
        res.json({ success: true, message: "Rank and warning configuration saved" });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

app.post('/api/admin/title', async (req, res) => {
    try {
        const { admin, targetUsername, title, customTitle } = req.body;
        if (!(await canMod(admin))) return res.json({ success: false, message: "No permission" });
        if (!targetUsername) return res.json({ success: false, message: "Enter a username" });
        const $set = {};
        if (title !== undefined) {
            $set.title = (String(title).trim() || "Member").slice(0, 40);
        }
        if (customTitle !== undefined) {
            $set.customTitle = String(customTitle).trim().slice(0, 40);
        }
        const result = await User.collection.updateOne(
            { username: targetUsername },
            { $set }
        );
        if (result.matchedCount === 0) return res.json({ success: false, message: "User not found" });
        res.json({ success: true, message: 'Updated title for ' + targetUsername });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

// Members Directory API
app.get('/api/members', async (req, res) => {
    try {
        const tab = String(req.query.tab || 'all').toLowerCase();
        const q = String(req.query.q || '').trim();
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const perPage = Math.min(50, Math.max(10, parseInt(req.query.perPage, 10) || 20));

        const filter = {};
        if (q) {
            const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            filter.username = { $regex: escaped, $options: 'i' };
        }

        const users = await User.find(filter).lean();
        const postCountsAgg = await Post.aggregate([
            { $group: { _id: '$user_id', count: { $sum: 1 } } }
        ]);
        const postCountMap = new Map(postCountsAgg.map(x => [String(x._id), x.count]));

        const allPosts = await Post.find({}).select('id user_id').lean();
        const postAuthorMap = new Map(allPosts.map(p => [String(p.id), p.user_id]));
        const allVotes = await Vote.find({ target_type: 'post' }).select('target_id').lean();
        const reactionMap = new Map();
        for (const v of allVotes) {
            const author = postAuthorMap.get(String(v.target_id));
            if (author) {
                reactionMap.set(author, (reactionMap.get(author) || 0) + 1);
            }
        }

        const ranksCfg = await getRanksConfig();
        const onlineCutoff = Date.now() - 5 * 60 * 1000;

        let enriched = users.map(u => {
            let roleTitle = u.title || "Member";
            if (u.username === "20k" && (!u.title || u.title === "Member")) roleTitle = "Owner";
            const postCount = postCountMap.get(u.username) || 0;
            const reactionScore = reactionMap.get(u.username) || 0;
            const rankInfo = computeRank(postCount, roleTitle, ranksCfg.ranks);
            const isStaff = isStaffTitle(roleTitle) || u.username === '20k';
            const online = !!(u.lastSeen && !u.hideActivity && new Date(u.lastSeen).getTime() >= onlineCutoff);
            return {
                username: u.username,
                pfp: u.pfp || "https://i.imgur.com/oJCfWc8.png",
                title: roleTitle,
                customTitle: u.customTitle || "",
                rankName: rankInfo.rankName,
                stars: rankInfo.stars,
                isStaff,
                postCount,
                reactionScore,
                created_at: u.created_at,
                lastSeen: u.hideActivity ? null : (u.lastSeen || u.created_at),
                online
            };
        });

        if (tab === 'staff') {
            enriched = enriched.filter(m => m.isStaff);
        }

        if (tab === 'messages') {
            enriched.sort((a, b) => b.postCount - a.postCount || a.username.localeCompare(b.username));
        } else if (tab === 'reactions') {
            enriched.sort((a, b) => b.reactionScore - a.reactionScore || b.postCount - a.postCount);
        } else if (tab === 'recent') {
            enriched.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        } else if (tab === 'staff') {
            enriched.sort((a, b) => (a.username === '20k' ? -1 : b.username === '20k' ? 1 : b.postCount - a.postCount));
        } else {
            enriched.sort((a, b) => a.username.localeCompare(b.username));
        }

        const total = enriched.length;
        const totalPages = Math.max(1, Math.ceil(total / perPage));
        const safePage = Math.min(page, totalPages);
        const items = enriched.slice((safePage - 1) * perPage, safePage * perPage);

        res.json({
            success: true,
            total,
            page: safePage,
            totalPages,
            members: items
        });
    } catch (err) {
        res.json({ success: false, total: 0, page: 1, totalPages: 1, members: [] });
    }
});

// Warning Points / Infractions System
app.post('/api/warnings', async (req, res) => {
    try {
        const { issuer, targetUsername, law, points, reason, expiresAt, postId, threadId } = req.body;
        if (!(await canMod(issuer))) {
            return res.status(403).json({ success: false, message: "Only Moderators and Owners can issue warnings" });
        }
        if (!targetUsername || !law) {
            return res.json({ success: false, message: "Target user and Law are required" });
        }
        if (targetUsername === '20k') {
            return res.json({ success: false, message: "Cannot warn the site owner" });
        }
        const target = await User.findOne({ username: targetUsername });
        if (!target) return res.json({ success: false, message: "Target user not found" });

        const pts = Math.min(50, Math.max(1, parseInt(points, 10) || 1));
        let expDate = null;
        if (expiresAt) {
            const parsed = new Date(expiresAt);
            if (!isNaN(parsed.getTime()) && parsed > new Date()) {
                expDate = parsed;
            }
        }

        const warningDoc = await new Warning({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            user_id: target.username,
            issued_by: issuer,
            post_id: postId || null,
            thread_id: threadId || null,
            law: String(law).trim().slice(0, 120),
            points: pts,
            reason: String(reason || '').trim().slice(0, 500),
            expires_at: expDate,
            active: true,
            created_at: new Date()
        }).save();

        await createAlert({
            to_user: target.username,
            from_user: issuer,
            type: 'warning',
            message: `You received a warning (${pts} pt${pts === 1 ? '' : 's'}) for ${warningDoc.law}: ${warningDoc.reason || 'Rule violation'}`,
            threadTitle: warningDoc.law,
            link: `/profile.html?user=${encodeURIComponent(target.username)}&tab=warnings`
        });

        // Calculate active warning points and apply threshold restrictions if needed
        const now = new Date();
        const activeList = await Warning.find({
            user_id: target.username,
            active: true,
            $or: [{ expires_at: null }, { expires_at: { $gt: now } }]
        }).lean();
        const totalPoints = activeList.reduce((sum, w) => sum + (w.points || 0), 0);

        const cfg = await getRanksConfig();
        const permThresh = cfg.warningThresholdPermBan || 20;
        const tempThresh = cfg.warningThresholdTempBan || 10;
        let autoAction = null;

        if (totalPoints >= permThresh) {
            target.banned = true;
            target.banType = 'permanent';
            target.banReason = `Reached ${totalPoints} warning points (${warningDoc.law})`;
            await target.save();
            autoAction = 'Permanent ban applied automatically (threshold reached)';
        } else if (totalPoints >= tempThresh && !target.banned) {
            target.banned = true;
            target.banType = 'temporary';
            target.banExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            target.banReason = `Reached ${totalPoints} warning points (${warningDoc.law})`;
            await target.save();
            autoAction = '7-day temporary restriction applied automatically (threshold reached)';
        }

        res.json({
            success: true,
            message: autoAction ? `Warning issued (${totalPoints} active pts). ${autoAction}` : `Warning issued (${totalPoints} active pts).`,
            totalPoints,
            warning: warningDoc
        });
    } catch (err) {
        res.json({ success: false, message: "Server error issuing warning" });
    }
});

app.get('/api/warnings/:username', async (req, res) => {
    try {
        const target = String(req.params.username || '').trim();
        const viewer = String(req.query.viewer || '').trim();
        if (!target || !viewer) return res.json({ success: false, warnings: [], activePoints: 0 });

        const isStaff = await canMod(viewer);
        if (viewer !== target && !isStaff) {
            return res.status(403).json({ success: false, message: "No permission", warnings: [], activePoints: 0 });
        }

        const now = new Date();
        await Warning.updateMany(
            { user_id: target, active: true, expires_at: { $ne: null, $lte: now } },
            { $set: { active: false } }
        );

        const list = await Warning.find({ user_id: target }).sort({ created_at: -1 }).lean();
        const activePoints = list
            .filter(w => w.active && (!w.expires_at || new Date(w.expires_at) > now))
            .reduce((s, w) => s + (w.points || 0), 0);

        res.json({ success: true, activePoints, warnings: list });
    } catch (err) {
        res.json({ success: false, warnings: [], activePoints: 0 });
    }
});

app.get('/api/admin/warnings', async (req, res) => {
    try {
        const viewer = String(req.query.username || '').trim();
        if (!(await canMod(viewer))) {
            return res.status(403).json({ success: false, warnings: [] });
        }
        const now = new Date();
        await Warning.updateMany(
            { active: true, expires_at: { $ne: null, $lte: now } },
            { $set: { active: false } }
        );
        const list = await Warning.find({}).sort({ created_at: -1 }).limit(100).lean();
        res.json({ success: true, warnings: list });
    } catch (err) {
        res.json({ success: false, warnings: [] });
    }
});

app.delete('/api/warnings/:id', async (req, res) => {
    try {
        const { username } = req.body;
        if (!(await canMod(username))) {
            return res.status(403).json({ success: false, message: "No permission" });
        }
        const w = await Warning.findOne({ id: String(req.params.id) });
        if (!w) return res.json({ success: false, message: "Warning not found" });
        w.active = false;
        await w.save();
        res.json({ success: true, message: "Warning revoked" });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

// Ignore User System
app.get('/api/ignores', async (req, res) => {
    try {
        const username = String(req.query.username || '').trim();
        if (!username) return res.json({ success: true, ignored: [] });
        const rows = await UserIgnore.find({ user_id: username }).sort({ created_at: -1 }).lean();
        const names = rows.map(r => r.ignored_user_id);
        const users = names.length ? await User.find({ username: { $in: names } }).select('username pfp title').lean() : [];
        const userMap = new Map(users.map(u => [u.username, u]));

        res.json({
            success: true,
            ignored: rows.map(r => {
                const u = userMap.get(r.ignored_user_id);
                return {
                    username: r.ignored_user_id,
                    pfp: (u && u.pfp) || "https://i.imgur.com/oJCfWc8.png",
                    title: (u && u.title) || "Member",
                    created_at: r.created_at
                };
            })
        });
    } catch (err) {
        res.json({ success: false, ignored: [] });
    }
});

app.post('/api/ignores/toggle', async (req, res) => {
    try {
        const { username, targetUsername } = req.body;
        if (!username || !targetUsername) {
            return res.json({ success: false, message: "Missing user information" });
        }
        if (String(username).toLowerCase() === String(targetUsername).toLowerCase()) {
            return res.json({ success: false, message: "You cannot ignore yourself" });
        }
        const target = await User.findOne({ username: targetUsername });
        if (!target) return res.json({ success: false, message: "User not found" });

        if (await canStaff(target.username)) {
            return res.json({ success: false, message: "Staff members cannot be ignored" });
        }

        const existing = await UserIgnore.findOne({ user_id: username, ignored_user_id: target.username });
        if (existing) {
            await UserIgnore.deleteOne({ _id: existing._id });
            return res.json({ success: true, ignored: false, message: `Unignored ${target.username}` });
        } else {
            await new UserIgnore({
                user_id: username,
                ignored_user_id: target.username,
                created_at: new Date()
            }).save();
            return res.json({ success: true, ignored: true, message: `Now ignoring ${target.username}` });
        }
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
    post.edited_at = new Date();
    await post.save();
    res.json({ success: true, message: "Updated", edited_at: post.edited_at });
});

app.post('/api/posts/:postId/react', async (req, res) => {
    try {
        const { username, reaction } = req.body;
        const postId = String(req.params.postId);
        if (!username) return res.json({ success: false, message: "Login required" });
        const post = await Post.findOne({ id: postId });
        if (!post) return res.json({ success: false, message: "Post not found" });

        const allowed = ['like', 'love', 'haha', 'fire', 'skull'];
        const rx = allowed.includes(reaction) ? reaction : 'like';

        const existing = await Vote.findOne({ target_type: 'post', target_id: postId, user_id: username });
        if (existing) {
            if ((existing.reaction || 'like') === rx) {
                await Vote.deleteOne({ _id: existing._id });
            } else {
                existing.reaction = rx;
                await existing.save();
            }
        } else {
            await new Vote({
                id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
                user_id: username,
                target_type: 'post',
                target_id: postId,
                vote_type: 1,
                reaction: rx,
                created_at: new Date()
            }).save();

            if (post.user_id && post.user_id !== username) {
                const thread = await Thread.findOne({ id: post.thread_id });
                const tTitle = (thread && thread.title) || 'd1sc';
                const tLink = '/thread.html?id=' + encodeURIComponent(post.thread_id) +
                    '&title=' + encodeURIComponent(tTitle) + '#post-' + postId;
                await createAlert({
                    to_user: post.user_id,
                    from_user: username,
                    type: 'reaction',
                    message: 'reacted to your post in "' + tTitle + '"',
                    threadTitle: tTitle,
                    link: tLink
                });
            }
        }

        const updated = await Vote.find({ target_type: 'post', target_id: postId }).lean();
        res.json({
            success: true,
            reactions: updated.map(v => ({ user_id: v.user_id, reaction: v.reaction || 'like' }))
        });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

app.delete('/api/posts/:postId', async (req, res) => {
    const { username } = req.body;
    const post = await Post.findOne({ id: req.params.postId });
    if (!post) return res.json({ success: false, message: "Post not found" });
    if (post.user_id !== username && !(await canMod(username))) return res.json({ success: false, message: "No permission" });
    await Post.deleteOne({ id: req.params.postId });
    await Bookmark.deleteMany({ post_id: req.params.postId });
    res.json({ success: true, message: "Deleted" });
});

app.delete('/api/threads/:threadId', async (req, res) => {
    const { username } = req.body;
    const thread = await Thread.findOne({ id: req.params.threadId });
    if (!thread) return res.json({ success: false, message: "Thread not found" });
    if (!(await canMod(username)) && thread.user_id !== username) return res.json({ success: false, message: "No permission" });
    await Post.deleteMany({ thread_id: thread.id });
    await Thread.deleteOne({ id: thread.id });
    await Report.deleteMany({ post_id: thread.id });
    await WatchedThread.deleteMany({ thread_id: thread.id });
    await Bookmark.deleteMany({ thread_id: thread.id });
    await Poll.deleteMany({ thread_id: thread.id });
    await PollVote.deleteMany({ thread_id: thread.id });
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
            if (user.banType === 'temporary' && user.banExpiresAt && new Date() > new Date(user.banExpiresAt)) {
                user.banned = false;
                user.banReason = "";
                user.banExpiresAt = null;
                await user.save();
                return res.json({ banned: false });
            }
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

// Heartbeat & Currently Viewing Tracking
app.post('/api/heartbeat', async (req, res) => {
    try {
        const { username, guestId, locationType, locationId } = req.body;
        await recordActivity({ username, guestId, locationType, locationId });
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false });
    }
});

app.get('/api/activity/viewers', async (req, res) => {
    try {
        const locType = String(req.query.type || 'other');
        const locId = String(req.query.id || '');
        const cutoff = new Date(Date.now() - 3 * 60 * 1000);

        const query = {
            location_type: locType,
            updated_at: { $gte: cutoff }
        };
        if (locId) query.location_id = locId;

        const rows = await UserActivity.find(query).sort({ updated_at: -1 }).lean();
        const seenUsers = new Set();
        const usernames = [];
        let guests = 0;
        let hiddenCount = 0;

        for (const r of rows) {
            if (r.is_guest || !r.username) {
                guests++;
            } else {
                if (seenUsers.has(r.username)) continue;
                seenUsers.add(r.username);
                if (r.hide_activity) {
                    hiddenCount++;
                } else {
                    usernames.push(r.username);
                }
            }
        }

        const userDocs = usernames.length
            ? await User.find({ username: { $in: usernames } }).select('username title pfp').lean()
            : [];
        const userMap = new Map(userDocs.map(u => [u.username, u]));

        const members = usernames.map(uname => {
            const u = userMap.get(uname);
            return {
                username: uname,
                title: (u && u.title) || (uname === '20k' ? 'Owner' : 'Member'),
                pfp: (u && u.pfp) || 'https://i.imgur.com/oJCfWc8.png'
            };
        });

        res.json({
            success: true,
            total: seenUsers.size + guests,
            memberCount: seenUsers.size,
            guestCount: guests,
            hiddenCount,
            members
        });
    } catch (err) {
        res.json({ success: false, total: 0, memberCount: 0, guestCount: 0, members: [] });
    }
});

app.get('/api/online-stats', async (req, res) => {
    try {
        const cutoff = new Date(Date.now() - 5 * 60 * 1000);
        const guestCutoff = new Date(Date.now() - 3 * 60 * 1000);
        const [members, threads, posts, onlineUsers, newest, activeGuests] = await Promise.all([
            User.countDocuments({}),
            Thread.countDocuments({}),
            Post.countDocuments({}),
            User.find({ lastSeen: { $gte: cutoff }, hideActivity: { $ne: true } })
                .select('username pfp title lastSeen')
                .sort({ lastSeen: -1 })
                .limit(80)
                .lean(),
            User.findOne({}).sort({ created_at: -1 }).select('username').lean(),
            UserActivity.countDocuments({ is_guest: true, updated_at: { $gte: guestCutoff } })
        ]);
        const online = onlineUsers.map(u => ({
            username: u.username,
            pfp: u.pfp || "https://i.imgur.com/oJCfWc8.png",
            title: u.title || (u.username === "20k" ? "Owner" : "Member")
        }));
        res.json({
            members,
            threads,
            posts,
            onlineCount: online.length,
            guestCount: activeGuests,
            online,
            newestMember: newest ? newest.username : ""
        });
    } catch (err) {
        res.json({ members: 0, threads: 0, posts: 0, onlineCount: 0, guestCount: 0, online: [], newestMember: "" });
    }
});

app.post('/api/admin/unban', async (req, res) => {
    try {
        const { admin, targetUsername } = req.body;
        if (!(await canMod(admin))) return res.json({ success: false, message: "No permission" });
        const user = await User.findOne({ username: targetUsername });
        if (!user) return res.json({ success: false, message: "User not found" });
        user.banned = false;
        user.banReason = "";
        user.banExpiresAt = null;
        await user.save();
        res.json({ success: true, message: 'User ' + targetUsername + ' has been unbanned.' });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

app.post('/api/admin/ban', async (req, res) => {
    try {
        const { admin, targetUsername, reason, type } = req.body;
        if (!(await canMod(admin))) return res.json({ success: false, message: "No permission" });
        if (targetUsername === '20k') return res.json({ success: false, message: "Cannot ban owner" });
        const user = await User.findOne({ username: targetUsername });
        if (!user) return res.json({ success: false, message: "User not found" });
        user.banned = true;
        user.banReason = reason || "No reason given";
        user.banType = type || "permanent";
        user.banExpiresAt = type === 'temporary' ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null;
        await user.save();
        res.json({ success: true, message: 'User ' + targetUsername + ' has been banned.' });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

app.delete('/api/admin/thread/:threadId', async (req, res) => {
    const { username } = req.body;
    if (!(await canMod(username))) return res.json({ success: false, message: "No permission" });
    const thread = await Thread.findOne({ id: req.params.threadId });
    if (!thread) return res.json({ success: false, message: "Thread not found" });
    await Post.deleteMany({ thread_id: thread.id });
    await Thread.deleteOne({ id: thread.id });
    await Report.deleteMany({ post_id: thread.id });
    await WatchedThread.deleteMany({ thread_id: thread.id });
    await Bookmark.deleteMany({ thread_id: thread.id });
    await Poll.deleteMany({ thread_id: thread.id });
    await PollVote.deleteMany({ thread_id: thread.id });
    res.json({ success: true, message: "Thread deleted" });
});

app.get('/api/admin/users', async (req, res) => {
    try {
        const admin = (req.query.admin || '').trim();
        if (!(await canMod(admin))) {
            return res.json({ success: false, message: 'No permission', users: [] });
        }
        const users = await User.find({})
            .select('username title customTitle banned banReason banType created_at pfp')
            .sort({ created_at: -1 })
            .lean();
        res.json({
            success: true,
            users: users.map(u => ({
                username: u.username,
                title: u.title || (u.username === '20k' ? 'Owner' : 'Member'),
                customTitle: u.customTitle || '',
                banned: !!u.banned,
                banReason: u.banReason || '',
                banType: u.banType || '',
                pfp: u.pfp || 'https://i.imgur.com/oJCfWc8.png',
                created_at: u.created_at
            }))
        });
    } catch (err) {
        console.error(err);
        res.json({ success: false, message: 'Server error', users: [] });
    }
});

app.post('/api/threads/:threadId/pin', async (req, res) => {
    try {
        const { username } = req.body;
        if (!(await canMod(username))) return res.json({ success: false, message: "Only Owner/Moderator can pin" });
        const thread = await Thread.findOne({ id: req.params.threadId });
        if (!thread) return res.json({ success: false, message: "Thread not found" });
        thread.pinned = !thread.pinned;
        await thread.save();
        res.json({ success: true, pinned: thread.pinned, message: thread.pinned ? "Pinned" : "Unpinned" });
    } catch (err) {
        res.json({ success: false, message: "Server error" });
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
    } catch (err) {
        res.json([]);
    }
});

app.listen(PORT, () => {
    console.log(`Running on http://localhost:${PORT}`);
});
