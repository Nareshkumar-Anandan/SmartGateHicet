const fs = require('fs');
const html = fs.readFileSync('backend/scripts/page__frmTemplateHTSeries_aspx.html', 'utf8');

const idx = html.indexOf('ContentPlaceHolder1_ASPxButton4');
console.log(html.substring(idx, idx + 600));

// Also check passCheck
const pIdx = html.indexOf('passCheck');
if (pIdx !== -1) {
  console.log('\npassCheck snippet:');
  console.log(html.substring(pIdx, pIdx + 600));
}
