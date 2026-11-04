const fs = require('fs');

let adminHtml = fs.readFileSync('public/admin.html', 'utf8').replace(/\r\n/g, '\n');

adminHtml = adminHtml.replace(
    "const res = await fetch('/api/admin/warnings?moderator=20k');",
    "const res = await fetch('/api/admin/warnings?moderator=' + encodeURIComponent(username || '20k'));"
);

adminHtml = adminHtml.replace(
    "body: JSON.stringify({ moderator: '20k' })",
    "body: JSON.stringify({ moderator: username || '20k' })"
);

fs.writeFileSync('public/admin.html', adminHtml.replace(/\n/g, '\r\n'), 'utf8');
console.log("public/admin.html updated successfully!");

