function testListParser(text) {
    let escaped = text;
    const innerListRegex = /\[list(?:=([^\s\]]+))?\]((?:(?!\[list[\s=\]])[\s\S])*?)\[\/list\]/gi;
    let iterations = 0;
    while (innerListRegex.test(escaped)) {
        iterations++;
        if (iterations > 20) {
            console.error("Too many list iterations!");
            break;
        }
        escaped = escaped.replace(innerListRegex, function (m, listParam, body) {
            // listParam could be '1', 'a', etc. or undefined
            let tag = 'ul';
            let extraAttr = '';
            if (listParam) {
                tag = 'ol';
                const p = String(listParam).trim().toLowerCase();
                if (p === 'a') extraAttr = ' type="a"';
                else if (p === 'i') extraAttr = ' type="i"';
                else if (p === '1') extraAttr = '';
                else {
                    const startNum = parseInt(p, 10);
                    if (!isNaN(startNum) && startNum > 1) {
                        extraAttr = ` start="${startNum}"`;
                    }
                }
            }
            // Parse items by [*]
            // Also handle optional [/*] closing tag
            const cleanedBody = body.replace(/\[\/\*\]/gi, '');
            const parts = cleanedBody.split(/\[\*\]/);
            let html = `<${tag} class="xf-list"${extraAttr}>`;
            let hasItems = false;
            for (let i = 1; i < parts.length; i++) {
                const item = parts[i].trim().replace(/^\n+|\n+$/g, '');
                if (item) {
                    html += `<li>${item}</li>`;
                    hasItems = true;
                }
            }
            if (!hasItems && cleanedBody.trim()) {
                html += `<li>${cleanedBody.trim()}</li>`;
            }
            html += `</${tag}>`;
            return html;
        });
    }
    console.log("Completed in iterations:", iterations);
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

const out = testListParser(fullPost);
console.log("Remaining [list]:", out.includes('[list]'));
console.log("Remaining [/list]:", out.includes('[/list]'));
console.log("Remaining [*]:", out.includes('[*]'));
console.log("\n--- Check Item 8 render ---");
const idx = out.indexOf('8. User Ranks');
console.log(out.slice(idx, idx + 600));

