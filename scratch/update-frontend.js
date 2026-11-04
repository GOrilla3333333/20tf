const fs = require('fs');

// 1. Update public/thread.html
let threadHtml = fs.readFileSync('public/thread.html', 'utf8').replace(/\r\n/g, '\n');

// 1a. CSS in thread.html
const oldThreadCss = `        .xf-list {
            margin: 8px 0 8px 24px;
            padding: 0;
            line-height: 1.6;
        }
        .xf-list li {
            margin: 3px 0;
        }
        .xf-list .xf-list {
            margin: 4px 0 4px 20px;
        }`;

const newThreadCss = `        .xf-list {
            margin: 8px 0 8px 24px;
            padding: 0;
            line-height: 1.6;
        }
        ul.xf-list {
            list-style-type: disc;
        }
        ol.xf-list {
            list-style-type: decimal;
        }
        .xf-list li {
            margin: 3px 0;
        }
        .xf-list .xf-list {
            margin: 4px 0 4px 20px;
        }
        ul.xf-list ul.xf-list {
            list-style-type: circle;
        }
        ol.xf-list ol.xf-list {
            list-style-type: lower-alpha;
        }`;

if (!threadHtml.includes(oldThreadCss)) {
    console.error("Thread CSS not found!");
    process.exit(1);
}
threadHtml = threadHtml.replace(oldThreadCss, () => newThreadCss);

// 1b. Warn select onchange in thread.html
const oldSelect = '<select id="warnLawSelect" style="width:100%;">';
const newSelect = '<select id="warnLawSelect" style="width:100%;" onchange="onWarnRuleChange()">';
if (!threadHtml.includes(oldSelect)) {
    console.error("warnLawSelect not found!");
    process.exit(1);
}
threadHtml = threadHtml.replace(oldSelect, () => newSelect);

// 1c. List parser in formatContent
const oldThreadList = `            // [list] & [list=1] (innermost list first)
            const innerListRegex = /\\[list(=1)?\\]((?:(?!\\[list[\\s=\\]])[\\s\\S])*?)\\[\\/list\\]/i;
            for (let iter = 0; iter < 8; iter++) {
                if (!innerListRegex.test(escaped)) break;
                escaped = escaped.replace(innerListRegex, function (m, isOrd, body) {
                    const tag = isOrd ? 'ol' : 'ul';
                    const parts = body.split(/\\[\\*\\]/);
                    let html = '<' + tag + ' class="xf-list">';
                    for (let i = 1; i < parts.length; i++) {
                        const item = parts[i].trim().replace(/^\\n+|\\n+$/g, '');
                        if (item) html += '<li>' + item + '</li>';
                    }
                    if (parts.length <= 1 && body.trim()) {
                        html += '<li>' + body.trim() + '</li>';
                    }
                    html += '</' + tag + '>';
                    return html;
                });
            }`;

const newThreadList = `            // [list] & [list=1] & [list=a] etc. (innermost list first, global /g for full document pass per level)
            const innerListRegex = /\\[list(?:=([^\\s\\]]+))?\\]((?:(?!\\[list[\\s=\\]])[\\s\\S])*?)\\[\\/list\\]/gi;
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
                        } else if (/^\\d+$/.test(p)) {
                            const num = parseInt(p, 10);
                            if (num > 1) extraAttr = ' start="' + num + '"';
                        }
                    }
                    const cleanedBody = body.replace(/\\[\\/\\*\\]/gi, '');
                    const parts = cleanedBody.split(/\\[\\*\\]/);
                    let html = '<' + tag + ' class="xf-list"' + extraAttr + '>';
                    let hasItems = false;
                    if (parts[0] && parts[0].trim()) {
                        html += '<li>' + parts[0].trim() + '</li>';
                        hasItems = true;
                    }
                    for (let i = 1; i < parts.length; i++) {
                        const item = parts[i].trim().replace(/^\\n+|\\n+$/g, '');
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
            }`;

if (!threadHtml.includes(oldThreadList)) {
    console.error("Thread List parser not found!");
    process.exit(1);
}
threadHtml = threadHtml.replace(oldThreadList, () => newThreadList);

// 1d. checkStaffControls in thread.html
const oldCheckStaff = `        async function checkStaffControls() {
            if (!username) return;
            let isMod = username === '20k';
            if (!isMod) {
                const me = await fetchProfile(username);
                const t = ((me && me.title) || '').toLowerCase();
                isMod = t === 'owner' || t === 'administrator' || t === 'admin' || t === 'moderator' || t === 'mod';
            }
            if (isMod && !isModUser) {
                isModUser = true;
                if (allFlatPosts.length) renderCurrentPage();
            }`;

const newCheckStaff = `        async function checkStaffControls() {
            if (!username) return;
            let isMod = false;
            try {
                const me = await fetchProfile(username);
                const t = ((me && (me.roleTitle || me.title)) || '').toLowerCase().trim();
                isMod = t === 'owner' || t === 'administrator' || t === 'admin' || t === 'moderator' || t === 'mod';
            } catch (e) {
                isMod = false;
            }
            if (isMod && !isModUser) {
                isModUser = true;
                if (allFlatPosts.length) renderCurrentPage();
            }`;

if (!threadHtml.includes(oldCheckStaff)) {
    console.error("oldCheckStaff not found!");
    process.exit(1);
}
threadHtml = threadHtml.replace(oldCheckStaff, () => newCheckStaff);

// 1e. Warn handlers in thread.html
const oldWarnHandlers = `        function onWarnRuleChange() {
            const sel = document.getElementById('warnRuleSelect');
            const pts = document.getElementById('warnPointsInput');
            if (!sel || !pts) return;
            const opt = sel.options[sel.selectedIndex];
            const defaultPts = opt && opt.getAttribute('data-pts');
            if (defaultPts) pts.value = defaultPts;
        }

        function openWarnModal(postId, targetUser) {
            currentWarnPostId = postId;
            currentWarnTargetUser = targetUser;
            const label = document.getElementById('warnTargetLabel');
            if (label) label.textContent = 'Target member: ' + targetUser + ' (Post #' + postId.slice(0, 8) + ')';
            document.getElementById('warnReasonInput').value = '';
            document.getElementById('warnExpiresInput').value = '';
            document.getElementById('warnModal').style.display = 'flex';
        }

        function closeWarnModal() {
            currentWarnPostId = null;
            currentWarnTargetUser = null;
            document.getElementById('warnModal').style.display = 'none';
        }

        async function submitWarning() {
            if (!currentWarnTargetUser) return;
            const rule = document.getElementById('warnRuleSelect').value;
            const points = Number(document.getElementById('warnPointsInput').value) || 1;
            const reason = document.getElementById('warnReasonInput').value.trim();
            const expires_at = document.getElementById('warnExpiresInput').value || null;
            try {
                const res = await fetch('/api/warnings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        moderator: username,
                        user_id: currentWarnTargetUser,
                        post_id: currentWarnPostId,
                        rule: rule,
                        points: points,
                        reason: reason,
                        expires_at: expires_at
                    })
                });
                const data = await res.json();
                if (data.success) {
                    closeWarnModal();
                    showNotification('Warning issued (' + data.activePoints + ' active pts)', '#16a34a');
                } else {
                    showNotification(data.message || 'Failed to issue warning', '#dc2626');
                }
            } catch (e) {
                showNotification('Server error', '#dc2626');
            }
        }`;

const newWarnHandlers = `        function onWarnRuleChange() {
            const sel = document.getElementById('warnLawSelect') || document.getElementById('warnRuleSelect');
            const pts = document.getElementById('warnPointsInput');
            if (!sel || !pts) return;
            const opt = sel.options[sel.selectedIndex];
            const defaultPts = opt && opt.getAttribute('data-pts');
            if (defaultPts) pts.value = defaultPts;
        }

        function openWarnModal(postId, targetUser) {
            currentWarnPostId = postId;
            currentWarnTargetUser = targetUser;
            const label = document.getElementById('warnTargetLabel');
            if (label) label.textContent = 'Target member: ' + targetUser + ' (Post #' + postId.slice(0, 8) + ')';
            document.getElementById('warnReasonInput').value = '';
            document.getElementById('warnExpiresInput').value = '';
            document.getElementById('warnModal').style.display = 'flex';
        }

        function closeWarnModal() {
            currentWarnPostId = null;
            currentWarnTargetUser = null;
            document.getElementById('warnModal').style.display = 'none';
        }

        async function submitWarning() {
            if (!currentWarnTargetUser) return;
            const lawSel = document.getElementById('warnLawSelect') || document.getElementById('warnRuleSelect');
            const rule = lawSel ? lawSel.value : '';
            const points = Number(document.getElementById('warnPointsInput').value) || 1;
            const reason = document.getElementById('warnReasonInput').value.trim();
            const expires_at = document.getElementById('warnExpiresInput').value || null;
            try {
                const res = await fetch('/api/warnings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        moderator: username,
                        user_id: currentWarnTargetUser,
                        post_id: currentWarnPostId,
                        thread_id: threadId,
                        rule: rule,
                        law: rule,
                        points: points,
                        reason: reason,
                        expires_at: expires_at
                    })
                });
                const data = await res.json();
                if (data.success) {
                    closeWarnModal();
                    const activePts = data.activePoints !== undefined ? data.activePoints : (data.totalPoints || points);
                    showNotification('Warning issued (' + activePts + ' active pts)', '#16a34a');
                } else {
                    showNotification(data.message || 'Failed to issue warning', '#dc2626');
                }
            } catch (e) {
                showNotification('Server error', '#dc2626');
            }
        }`;

if (!threadHtml.includes(oldWarnHandlers)) {
    console.error("oldWarnHandlers not found!");
    process.exit(1);
}
threadHtml = threadHtml.replace(oldWarnHandlers, () => newWarnHandlers);

fs.writeFileSync('public/thread.html', threadHtml.replace(/\n/g, '\r\n'), 'utf8');
console.log("public/thread.html updated successfully!");

// 2. Update public/css/style.css
let styleCss = fs.readFileSync('public/css/style.css', 'utf8').replace(/\r\n/g, '\n');
const oldStyleList = `.xf-list {
    margin: 8px 0 8px 24px;
    padding: 0;
    line-height: 1.6;
}
.xf-list li {
    margin: 3px 0;
}
.xf-list .xf-list {
    margin: 4px 0 4px 20px;
}`;

const newStyleList = `.xf-list {
    margin: 8px 0 8px 24px;
    padding: 0;
    line-height: 1.6;
}
ul.xf-list {
    list-style-type: disc;
}
ol.xf-list {
    list-style-type: decimal;
}
.xf-list li {
    margin: 3px 0;
}
.xf-list .xf-list {
    margin: 4px 0 4px 20px;
}
ul.xf-list ul.xf-list {
    list-style-type: circle;
}
ol.xf-list ol.xf-list {
    list-style-type: lower-alpha;
}`;

if (!styleCss.includes(oldStyleList)) {
    console.error("oldStyleList not found in style.css!");
    process.exit(1);
}
styleCss = styleCss.replace(oldStyleList, () => newStyleList);
fs.writeFileSync('public/css/style.css', styleCss.replace(/\n/g, '\r\n'), 'utf8');
console.log("public/css/style.css updated successfully!");

// 3. Update public/inbox.html
let inboxHtml = fs.readFileSync('public/inbox.html', 'utf8').replace(/\r\n/g, '\n');
const oldInboxList = `            const innerListRegex = /\\[list(=1)?\\]((?:(?!\\[list[\\s=\\]])[\\s\\S])*?)\\[\\/list\\]/i;
            for (let iter = 0; iter < 8; iter++) {
                if (!innerListRegex.test(escaped)) break;
                escaped = escaped.replace(innerListRegex, function (m, isOrd, body) {
                    const tag = isOrd ? 'ol' : 'ul';
                    const parts = body.split(/\\[\\*\\]/);
                    let html = '<' + tag + ' class="xf-list">';
                    for (let i = 1; i < parts.length; i++) {
                        const item = parts[i].trim().replace(/^\\n+|\\n+$/g, '');
                        if (item) html += '<li>' + item + '</li>';
                    }
                    if (parts.length <= 1 && body.trim()) {
                        html += '<li>' + body.trim() + '</li>';
                    }
                    html += '</' + tag + '>';
                    return html;
                });
            }`;

const newInboxList = `            // [list] & [list=1] & [list=a] etc. (innermost list first, global /g for full document pass per level)
            const innerListRegex = /\\[list(?:=([^\\s\\]]+))?\\]((?:(?!\\[list[\\s=\\]])[\\s\\S])*?)\\[\\/list\\]/gi;
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
                        } else if (/^\\d+$/.test(p)) {
                            const num = parseInt(p, 10);
                            if (num > 1) extraAttr = ' start="' + num + '"';
                        }
                    }
                    const cleanedBody = body.replace(/\\[\\/\\*\\]/gi, '');
                    const parts = cleanedBody.split(/\\[\\*\\]/);
                    let html = '<' + tag + ' class="xf-list"' + extraAttr + '>';
                    let hasItems = false;
                    if (parts[0] && parts[0].trim()) {
                        html += '<li>' + parts[0].trim() + '</li>';
                        hasItems = true;
                    }
                    for (let i = 1; i < parts.length; i++) {
                        const item = parts[i].trim().replace(/^\\n+|\\n+$/g, '');
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
            }`;

if (!inboxHtml.includes(oldInboxList)) {
    console.error("oldInboxList not found in inbox.html!");
    process.exit(1);
}
inboxHtml = inboxHtml.replace(oldInboxList, () => newInboxList);
fs.writeFileSync('public/inbox.html', inboxHtml.replace(/\n/g, '\r\n'), 'utf8');
console.log("public/inbox.html updated successfully!");

// 4. Update public/profile.html
let profileHtml = fs.readFileSync('public/profile.html', 'utf8').replace(/\r\n/g, '\n');
const oldProfileCheck = `        async function checkViewerModStatus() {
            if (!currentUser) return false;
            if (currentUser === '20k') return true;
            try {
                const res = await fetch(\`/api/profile/\${encodeURIComponent(currentUser)}\`);
                const d = await res.json();
                const t = ((d && (d.roleTitle || d.title)) || '').toLowerCase();
                return t === 'owner' || t === 'administrator' || t === 'admin' || t === 'moderator' || t === 'mod';
            } catch (e) {
                return false;
            }
        }`;

const newProfileCheck = `        async function checkViewerModStatus() {
            if (!currentUser) return false;
            try {
                const res = await fetch(\`/api/profile/\${encodeURIComponent(currentUser)}\`);
                const d = await res.json();
                const t = ((d && (d.roleTitle || d.title)) || '').toLowerCase().trim();
                return t === 'owner' || t === 'administrator' || t === 'admin' || t === 'moderator' || t === 'mod';
            } catch (e) {
                return false;
            }
        }`;

if (!profileHtml.includes(oldProfileCheck)) {
    console.error("oldProfileCheck not found in profile.html!");
    process.exit(1);
}
profileHtml = profileHtml.replace(oldProfileCheck, () => newProfileCheck);
fs.writeFileSync('public/profile.html', profileHtml.replace(/\n/g, '\r\n'), 'utf8');
console.log("public/profile.html updated successfully!");

