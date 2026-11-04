require('dotenv').config({ path: 'c:/Users/Gogong/20tf/.env' });
const mongoose = require('mongoose');
const Post = require('c:/Users/Gogong/20tf/models/Post');
const fs = require('fs');

function escapeHtml(s) {
    return String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function parseIframeTag(tag) { return ''; }
function getYouTubeEmbedUrl(url) { return null; }
function buildIframeHtml(url, w, h) { return ''; }

// Copy-paste formatContent from thread.html exactly:
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

    return escaped;
}

mongoose.connect(process.env.MONGO_URI).then(async () => {
    const post = await Post.findOne({ id: 'mvxg92ygp' }).lean();
    const result = formatContent(post.content);
    console.log("Does result contain [list]?", result.includes('[list]'));
    console.log("Does result contain [/list]?", result.includes('[/list]'));
    console.log("Does result contain [*]?", result.includes('[*]'));
    if (result.includes('[list]') || result.includes('[*]')) {
        console.log("FAILED CHUNK:", result.slice(result.indexOf('[list]') - 50, result.indexOf('[list]') + 300));
    }
    process.exit(0);
});
