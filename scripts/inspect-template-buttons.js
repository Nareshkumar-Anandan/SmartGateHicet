const fs = require('fs');
const b = fs.readFileSync('backend/scripts/page__frmTemplateHTSeries_aspx.html', 'utf8');
const regex = /id="(ContentPlaceHolder1_ASPxButton\d+)"/g;
let match;
while ((match = regex.exec(b)) !== null) {
  const id = match[1];
  const idx = b.indexOf(id);
  const snippet = b.substring(idx, idx + 400).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  console.log(`${id}: ${snippet}`);
}
