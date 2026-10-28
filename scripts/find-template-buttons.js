const fs = require('fs');
const html = fs.readFileSync('scripts/page__frmTemplateHTSeries_aspx.html', 'utf8');

const regex = /<[^>]+id=["']([^"']*(?:btn|button|upload|delete|image|chk|rad)[^"']*)["'][^>]*>/gi;
let m;
while ((m = regex.exec(html)) !== null) {
  console.log(m[0].slice(0, 150));
}
