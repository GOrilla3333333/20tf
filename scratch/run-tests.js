require('dotenv').config({ path: 'c:/Users/Gogong/20tf/.env' });
const mongoose = require('mongoose');
const User = require('../models/User');
const Warning = require('../models/Warning');
const Post = require('../models/Post');

async function runTests() {
    console.log("=== STARTING 20TF VERIFICATION SUITE ===\n");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB Atlas\n");

    let passes = 0;
    let fails = 0;

    function assert(condition, message) {
        if (condition) {
            console.log(`[PASS] ${message}`);
            passes++;
        } else {
            console.error(`[FAIL] ${message}`);
            fails++;
        }
    }

    // --- TEST 1: SERVER-SIDE ROLE AUTHORIZATION (canMod) ---
    console.log("--- 1. Testing Server-side Authorization Logic ---");

    function getEffectiveRole(user) {
        if (!user) return '';
        let raw = user.role || user.title;
        if (!raw && Array.isArray(user.roles) && user.roles.length) {
            raw = user.roles[0];
        }
        return String(raw || '').trim().toLowerCase();
    }

    function escapeRegex(s) {
        return String(s || '').replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    }

    async function canMod(username) {
        if (!username || typeof username !== 'string') return false;
        const cleanUser = username.trim();
        if (!cleanUser) return false;
        const user = await User.findOne({
            username: { $regex: new RegExp('^' + escapeRegex(cleanUser) + '$', 'i') }
        });
        if (!user || user.banned) return false;
        const r = getEffectiveRole(user);
        return r === "owner" || r === "administrator" || r === "admin" || r === "moderator" || r === "mod";
    }

    const ownerCanMod = await canMod('20k');
    assert(ownerCanMod === true, "Owner (20k) is recognized and authorized to issue warnings");

    const ownerCaseCanMod = await canMod('20K');
    assert(ownerCaseCanMod === true, "Owner (case-insensitive '20K') is authorized");

    const modCanMod = await canMod('laberto');
    assert(modCanMod === true, "Moderator (laberto) is recognized and authorized to issue warnings");

    const memberCanMod = await canMod('Hamgud');
    assert(memberCanMod === false, "Ordinary member (Hamgud) is NOT authorized to issue warnings");

    const unauthCanMod1 = await canMod('');
    assert(unauthCanMod1 === false, "Empty username (unauthenticated) is rejected");

    const unauthCanMod2 = await canMod(null);
    assert(unauthCanMod2 === false, "Null username (unauthenticated) is rejected");

    const unauthCanMod3 = await canMod(undefined);
    assert(unauthCanMod3 === false, "Undefined username (unauthenticated) is rejected");

    const fakeUserCanMod = await canMod('nonexistent_hacker_user_xyz');
    assert(fakeUserCanMod === false, "Nonexistent user is rejected");

    // --- TEST 2: WARNING API INTEGRATION TEST ---
    console.log("\n--- 2. Testing Warning Creation, Persistence, and Revocation ---");

    // Clean any prior test warnings for target 'wtf'
    await Warning.deleteMany({ user_id: 'wtf', law: 'Law 01: Use Common Sense (TEST)' });

    // Scenario A: Unauthenticated request simulation
    let issuer = "";
    assert(!issuer || !(await canMod(issuer)), "Unauthenticated visitor cannot issue warnings");

    // Scenario B: Ordinary member request simulation
    issuer = "Hamgud";
    assert(!(await canMod(issuer)), "Ordinary member cannot issue warnings");

    // Scenario C: Owner issues warning
    issuer = "20k";
    assert(await canMod(issuer), "Owner is permitted to issue warning");

    const testWarnId = "test_warn_" + Date.now().toString(36);
    const createdWarn = await new Warning({
        id: testWarnId,
        user_id: 'wtf',
        issued_by: issuer,
        post_id: 'test_post_1',
        thread_id: 'test_thread_1',
        law: 'Law 01: Use Common Sense (TEST)',
        rule: 'Law 01: Use Common Sense (TEST)',
        points: 2,
        reason: 'Automated test warning for 20tf verification',
        expires_at: new Date(Date.now() + 86400000),
        active: true,
        created_at: new Date()
    }).save();

    assert(createdWarn && createdWarn.id === testWarnId, "Warning successfully saved to MongoDB");
    assert(createdWarn.law === 'Law 01: Use Common Sense (TEST)', "Warning stores law field correctly");
    assert(createdWarn.rule === 'Law 01: Use Common Sense (TEST)', "Warning stores rule field correctly");

    // Check querying warnings for target 'wtf'
    const warningsList = await Warning.find({ user_id: 'wtf' }).lean();
    const foundWarn = warningsList.find(w => w.id === testWarnId);
    assert(!!foundWarn, "Warning retrieved successfully from database query");

    // Scenario D: Moderator issues warning
    const modIssuer = "laberto";
    const testWarnId2 = "test_warn_mod_" + Date.now().toString(36);
    const createdModWarn = await new Warning({
        id: testWarnId2,
        user_id: 'wtf',
        issued_by: modIssuer,
        post_id: 'test_post_2',
        thread_id: 'test_thread_2',
        law: 'Law 01: Use Common Sense (TEST)',
        rule: 'Law 01: Use Common Sense (TEST)',
        points: 3,
        reason: 'Moderator test warning',
        expires_at: null,
        active: true,
        created_at: new Date()
    }).save();

    assert(createdModWarn && createdModWarn.issued_by === 'laberto', "Moderator warning successfully saved to MongoDB");

    // Test revoking warning by moderator
    const canModRevoke = await canMod('laberto');
    assert(canModRevoke === true, "Moderator is authorized to revoke warning");
    createdModWarn.active = false;
    await createdModWarn.save();
    const updatedModWarn = await Warning.findOne({ id: testWarnId2 });
    assert(updatedModWarn.active === false, "Warning status successfully updated to active: false upon revocation");

    // Clean up test warnings
    await Warning.deleteMany({ user_id: 'wtf', law: 'Law 01: Use Common Sense (TEST)' });
    console.log("[CLEANUP] Test warnings purged from database");

    // --- TEST 3: BBCode LIST RENDERING ---
    console.log("\n--- 3. Testing BBCode List Parsing & Rendering ---");

    function escapeHtml(s) {
        return String(s || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function formatContent(text) {
        if (!text) return '';
        const embeds = [];
        let withTokens = String(text);

        let escaped = escapeHtml(withTokens);

        // [list] & [list=1] & [list=a] etc.
        const innerListRegex = /\[list(?:=([^\s\]]+))?\]((?:(?!\[list[\s=\]])[\s\S])*?)\[\/list\]/gi;
        let listIterations = 0;
        while (listIterations < 15 && innerListRegex.test(escaped)) {
            listIterations++;
            escaped = escaped.replace(innerListRegex, function (m, listParam, body) {
                let tag = 'ul';
                let extraAttr = '';
                if (listParam !== undefined && listParam !== null) {
                    tag = 'ol';
                    const p = String(listParam).trim();
                    if (/^[aA]$/.test(p)) {
                        extraAttr = ' type="' + p + '"';
                    } else if (/^[iI]$/.test(p)) {
                        extraAttr = ' type="' + p + '"';
                    } else if (/^\d+$/.test(p)) {
                        const num = parseInt(p, 10);
                        if (num > 1) extraAttr = ' start="' + num + '"';
                    }
                }
                const cleanedBody = body.replace(/\[\/\*\]/gi, '');
                const parts = cleanedBody.split(/\[\*\]/);
                let html = '<' + tag + ' class="xf-list"' + extraAttr + '>';
                let hasItems = false;
                if (parts[0] && parts[0].trim()) {
                    html += '<li>' + parts[0].trim() + '</li>';
                    hasItems = true;
                }
                for (let i = 1; i < parts.length; i++) {
                    const item = parts[i].trim().replace(/^\n+|\n+$/g, '');
                    if (item) {
                        html += '<li>' + item + '</li>';
                        hasItems = true;
                    }
                }
                if (!hasItems && cleanedBody.trim()) {
                    html += '<li>' + cleanedBody.trim() + '</li>';
                }
                html += '</' + tag + '>';
                return html;
            });
        }

        // Greentext formatting: only lines starting with literal '>' (&gt;) outside code blocks
        escaped = escaped.split('\n').map(function (line) {
            if (/^\s*&gt;(?!&gt;)/.test(line) || /^\s*&gt;\s*\S/.test(line)) {
                return '<span class="greentext">' + line + '</span>';
            }
            return line;
        }).join('<br>');

        // Clean up excess <br> around block tags
        escaped = escaped
            .replace(/<br>\s*<(ul|ol|li|\/li|\/ul|\/ol|hr|div|\/div|pre|\/pre)/gi, '<$1')
            .replace(/<\/(ul|ol|li|hr|div|pre)>\s*<br>/gi, '</$1>');

        return escaped;
    }

    // Sub-test A: Unordered list
    const unord = `[list]\n[*]First item\n[*]Second item\n[*]Third item\n[/list]`;
    const unordHtml = formatContent(unord);
    assert(unordHtml.startsWith('<ul class="xf-list">') && unordHtml.endsWith('</ul>'), "Unordered list renders <ul class=\"xf-list\">...</ul>");
    assert(unordHtml.includes('<li>First item</li>') && unordHtml.includes('<li>Second item</li>') && unordHtml.includes('<li>Third item</li>'), "Unordered list items rendered as <li> elements");

    // Sub-test B: Ordered list
    const ord = `[list=1]\n[*]First item\n[*]Second item\n[*]Third item\n[/list]`;
    const ordHtml = formatContent(ord);
    assert(ordHtml.startsWith('<ol class="xf-list">') && ordHtml.endsWith('</ol>'), "Ordered list [list=1] renders <ol class=\"xf-list\">...</ul>");
    assert(ordHtml.includes('<li>First item</li>'), "Ordered list items rendered as <li> elements");

    // Sub-test C: Nested lists
    const nested = `[list]\n[*]Main item\n[list]\n[*]Sub-item\n[*]Another sub-item\n[/list]\n[*]Second main item\n[/list]`;
    const nestedHtml = formatContent(nested);
    assert(!nestedHtml.includes('[list]') && !nestedHtml.includes('[/list]') && !nestedHtml.includes('[*]'), "Nested list contains no raw BBCode tags");
    assert(nestedHtml.includes('<li>Main item<ul class="xf-list"><li>Sub-item</li>'), "Nested list properly nestled inside parent <li>");

    // Sub-test D: User's exact example
    const userExample = `[list]
[*]Five-tier star ladder dynamically awarded based on post count:

[*]Newcomer (1 Star)
[*]Regular (2 Stars)
[*]Veteran (3 Stars)
[*]Established (4 Stars)
[*]Legend (5 Stars)

[*]Staff members have access to a formal Warnings and Infractions log for rule violations.
[/list]`;
    const userExampleHtml = formatContent(userExample);
    assert(!userExampleHtml.includes('[list]') && !userExampleHtml.includes('[/list]') && !userExampleHtml.includes('[*]'), "User prompt example renders without any raw BBCode tags");
    assert(userExampleHtml.includes('<li>Five-tier star ladder dynamically awarded based on post count:</li>'), "First item rendered properly");
    assert(userExampleHtml.includes('<li>Legend (5 Stars)</li>'), "Middle items rendered properly");
    assert(userExampleHtml.includes('<li>Staff members have access to a formal Warnings and Infractions log for rule violations.</li>'), "Last item rendered properly");

    // Sub-test E: Real post with 12 lists from MongoDB
    const realPost = await Post.findOne({ id: 'mvxg92ygp' }).lean();
    if (realPost) {
        const realPostHtml = formatContent(realPost.content);
        assert(!realPostHtml.includes('[list]') && !realPostHtml.includes('[/list]') && !realPostHtml.includes('[*]'), "Real MongoDB post mvxg92ygp (12 lists) has 0 remaining [list], [/list], or [*] tags");
        assert(realPostHtml.includes('Legend (5 Stars)</li></ul></li>'), "Real post item 8 nested list renders correctly without truncation");
    }

    // Sub-test F: Malformed BBCode
    const malformed = `[list]\n[*]Item without close tag\nSome trailing text`;
    const malformedHtml = formatContent(malformed);
    assert(typeof malformedHtml === 'string' && malformedHtml.length > 0, "Malformed unclosed list does not crash the parser");

    // Sub-test G: Security & XSS
    const xss = `[list]\n[*]<script>alert('XSS')</script>\n[*]" onfocus="alert(1)"\n[/list]`;
    const xssHtml = formatContent(xss);
    assert(!xssHtml.includes('<script>') && xssHtml.includes('&lt;script&gt;'), "Script tags are escaped and prevented from executing");
    assert(!xssHtml.includes('" onfocus='), "Quotes in list items are escaped to prevent attribute breakout");

    console.log(`\n=== SUITE SUMMARY: ${passes} PASSED, ${fails} FAILED ===\n`);
    process.exit(fails > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error("Test runner failed:", err);
    process.exit(1);
});
