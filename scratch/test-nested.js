function escapeHtml(s) {
    return String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function parseIframeTag(tag) { return ''; }

function formatContent(text) {
    if (!text) return '';
    const embeds = [];
    let withTokens = String(text).replace(/<iframe\b[^>]*>(?:[\s\S]*?<\/iframe>)?/gi, function (match) {
        const html = parseIframeTag(match);
        if (!html) return match;
        const token = '\u0000EMBED_' + embeds.length + '\u0000';
        embeds.push(html);
        return token;
    });

    withTokens = withTokens.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, function (full, code) {
        const token = '\u0000EMBED_' + embeds.length + '\u0000';
        embeds.push('<pre class="xf-code">' + escapeHtml(code.replace(/^\n+|\n+$/g, '')) + '</pre>');
        return token;
    });

    let escaped = escapeHtml(withTokens);
    escaped = escaped.replace(/(https?:\/\/[^\s<\u0000[\]]+)/g, function (url) {
        return url;
    });

    // BBCode Horizontal Rule
    escaped = escaped.replace(/\[hr\]/gi, '<hr class="xf-hr">');

    // [url=...]...[/url] & [url]...[/url]
    escaped = escaped.replace(/\[url=(https?:\/\/[^\s\]"]+)\]([\s\S]*?)\[\/url\]/gi, '<a href="$1" target="_blank" rel="noopener noreferrer">$2</a>');
    escaped = escaped.replace(/\[url\](https?:\/\/[^\s\]"]+)\[\/url\]/gi, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

    // [img]...[/img]
    escaped = escaped.replace(/\[img\](https?:\/\/[^\s\]"]+)\[\/img\]/gi, '<img class="embed-media" src="$1" alt="image" loading="lazy">');

    // [color=...] (repeat up to 5 levels)
    for (let i = 0; i < 5; i++) {
        if (!/\[color=[^\]]+\]/i.test(escaped)) break;
        escaped = escaped.replace(/\[color=(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)\]([\s\S]*?)\[\/color\]/gi, '<span style="color:$1;">$2</span>');
    }

    // [size=...] (1-7 or px, max 36px)
    const sizeMap = { "1": "10.5px", "2": "12px", "3": "13.5px", "4": "15px", "5": "18px", "6": "22px", "7": "26px" };
    for (let i = 0; i < 5; i++) {
        if (!/\[size=[^\]]+\]/i.test(escaped)) break;
        escaped = escaped.replace(/\[size=([0-9]+(?:px)?)\]([\s\S]*?)\[\/size\]/gi, function (m, sz, body) {
            const num = parseInt(sz, 10);
            const px = sizeMap[sz] || (num ? Math.min(36, Math.max(9, num)) + 'px' : '14px');
            return '<span style="font-size:' + px + ';line-height:1.35;">' + body + '</span>';
        });
    }

    // [font=...]
    escaped = escaped.replace(/\[font=([a-zA-Z0-9\s,-]+)\]([\s\S]*?)\[\/font\]/gi, '<span style="font-family:$1;">$2</span>');

    // [b], [i], [u], [s], [sub], [sup]
    escaped = escaped
        .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>')
        .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>')
        .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<u>$1</u>')
        .replace(/\[s\]([\s\S]*?)\[\/s\]/gi, '<s>$1</s>')
        .replace(/\[sub\]([\s\S]*?)\[\/sub\]/gi, '<sub>$1</sub>')
        .replace(/\[sup\]([\s\S]*?)\[\/sup\]/gi, '<sup>$1</sup>');

    // [center] & [align=...]
    escaped = escaped
        .replace(/\[center\]([\s\S]*?)\[\/center\]/gi, '<div style="text-align:center;">$1</div>')
        .replace(/\[align=(center|left|right|justify)\]([\s\S]*?)\[\/align\]/gi, '<div style="text-align:$1;">$2</div>');

    // [list] & [list=1] (innermost list first)
    const innerListRegex = /\[list(=1)?\]((?:(?!\[list[\s=\]])[\s\S])*?)\[\/list\]/i;
    for (let iter = 0; iter < 8; iter++) {
        if (!innerListRegex.test(escaped)) break;
        escaped = escaped.replace(innerListRegex, function (m, isOrd, body) {
            const tag = isOrd ? 'ol' : 'ul';
            const parts = body.split(/\[\*\]/);
            let html = '<' + tag + ' class="xf-list">';
            for (let i = 1; i < parts.length; i++) {
                const item = parts[i].trim().replace(/^\n+|\n+$/g, '');
                if (item) html += '<li>' + item + '</li>';
            }
            if (parts.length <= 1 && body.trim()) {
                html += '<li>' + body.trim() + '</li>';
            }
            html += '</' + tag + '>';
            return html;
        });
    }

    // Clean up excess <br> around block tags
    escaped = escaped
        .replace(/<br>\s*<(ul|ol|li|\/li|\/ul|\/ol|hr|div|\/div|pre|\/pre)/gi, '<$1')
        .replace(/<\/(ul|ol|li|hr|div|pre)>\s*<br>/gi, '</$1>')
        .replace(/<(hr class="[^"]+")>\s*<br>/gi, '<$1>');

    return escaped;
}

const fullPost = `[size=5][b][color=#e11d48][Announcement][/color] Major Platform Update: XenForo 2 Architecture & Community System[/b][/size]

[hr]

We have rolled out a major platform update across the forum. This release replaces temporary styling with a permanent, high-contrast dark slate architecture and introduces full database-backed community tools.

[size=4][b]Changelog & New Features[/b][/size]

[b]1. Dedicated Announcement Prefix[/b]
[list]
[*]A special crimson [b]Announcement[/b] badge has been introduced, restricted strictly to the News & Announcements board.
[/list]

[b]2. Watched Threads & Post Bookmarks[/b]
[list]
[*]Click the [b]Watch[/b] button in the upper header of any thread to subscribe. Subscribed threads will dispatch alerts when new replies are posted.
[*]Every post now features a bookmark icon next to its post number to save individual posts directly to your account Bookmarks.
[/list]

[b]3. Thread Polls[/b]
[list]
[*]Thread creators can now attach polls during thread creation with 2 to 6 choices.
[*]Supports single-choice or multiple-choice voting with optional closing dates.
[*]Live percentage bars and voter counts update automatically upon submission.
[/list]

[b]4. Multi-Quote Selection Queue[/b]
[list]
[*][b]+Quote[/b] allows you to queue multiple posts across a thread.
[*]Opening the reply box provides an [b]Insert Quotes[/b] action to batch-paste all selected quotes with username attribution and permalinks.
[/list]

[b]5. Automatic Greentext Formatting[/b]
[list]
[*]Lines beginning with [b]>[/b] automatically render in classic greentext ([color=#789922]#789922[/color]).
[*]Preserves line breaks and ignores formatting inside code blocks.
[/list]

[b]6. User Signatures[/b]
[list]
[*]Post footers now display user signatures below a subtle divider.
[*]Supports formatted text, links, and embedded images configured via your profile.
[/list]

[b]7. Private Conversations (Direct Messaging)[/b]
[list]
[*]Full member-to-member direct messaging system accessible via the [b]Inbox[/b].
[*]Supports multi-participant conversations, unread alerts, and the ability to leave conversations.
[/list]

[b]8. User Ranks, Star Progression & Moderation System[/b]
[list]
[*]Five-tier star ladder dynamically awarded based on post count:
[list]
[*]Newcomer (1 Star)
[*]Regular (2 Stars)
[*]Veteran (3 Stars)
[*]Established (4 Stars)
[*]Legend (5 Stars)
[/list]
[*]Staff members have access to a formal Warnings and Infractions log for rule violations.
[/list]

[b]9. User Ignore List[/b]
[list]
[*]You can ignore any user from their profile or post header. Threads and posts from ignored members are automatically collapsed and hidden from your feed.
[/list]

[b]10. Live Who is Online & Location Tracking[/b]
[list]
[*]Real-time member activity restored to the sidebar and member directory.
[*]Displays whether users are browsing index boards, viewing threads, or inspecting directories, with privacy controls in your account settings.
[/list]

[b]11. High-Density Interface Overhaul[/b]
[list]
[*]Replaced floating cards and gradients with a clean, high-contrast dark slate layout (#141926 background, #202738 containers, #252d40 headers, #2d364d borders, tight 2px to 3px radius).
[/list]

[hr]

[i]If you run into any issues or notice display quirks, please report them in this thread or submit a report to staff.[/i]`;

const out = formatContent(fullPost);
console.log("Length of output:", out.length);
console.log("Remaining [list]:", out.includes('[list]'));
console.log("Remaining [/list]:", out.includes('[/list]'));
console.log("Remaining [*]:", out.includes('[*]'));
if (out.includes('[list]')) {
    console.log("Substring around [list]:", out.slice(out.indexOf('[list]') - 50, out.indexOf('[list]') + 200));
}
