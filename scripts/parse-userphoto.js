const fs = require('fs');

const html = fs.readFileSync('scripts/page__UserPhoto_aspx.html', 'utf8');

// Find all buttons, links, inputs
const matches = [];
const regex = /<(?:input|button|a)[^>]+id=["']([^"']*)["'][^>]*>/gi;
let m;
while ((m = regex.exec(html)) !== null) {
  const full = m[0];
  const id = m[1];
  if (!id.includes('DXDataRow') && !id.includes('VIEWSTATE')) {
    matches.push({ id, full });
  }
}

console.log('UserPhoto controls:');
matches.forEach(x => console.log('  ', x.id, x.full.slice(0, 100)));
