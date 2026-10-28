const fs = require('fs');

const html = fs.readFileSync('./scripts/page__UserPhoto_aspx.html', 'utf8');
const rows = html.match(/<tr id="[^"]*DXDataRow\d+"[\s\S]*?<\/tr>/gi) || [];
if (rows.length > 0) {
  console.log('--- Row 0 ---');
  console.log(rows[0]);
}
if (rows.length > 8) {
  console.log('--- Row 8 ---');
  console.log(rows[8]);
}
