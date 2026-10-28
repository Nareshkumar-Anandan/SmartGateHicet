const fs = require('fs');

const html = fs.readFileSync('scripts/page__DownloadUser_aspx.html', 'utf8');

// Find all ASPx controls and input elements
const lines = [];
const regex = /<tr[\s\S]*?<\/tr>/gi;
let m;
while ((m = regex.exec(html)) !== null) {
  const row = m[0];
  const text = row.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (text && (text.includes('User') || text.includes('Device') || text.includes('Photo') || text.includes('Download') || text.includes('Upload') || text.includes('Card') || text.includes('Finger') || text.includes('Face'))) {
    lines.push(text);
  }
}

console.log('DownloadUser.aspx Rows:');
[...new Set(lines)].forEach(l => console.log(' - ', l));
