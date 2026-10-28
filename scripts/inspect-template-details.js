const fs = require('fs');
const html = fs.readFileSync('backend/scripts/page__frmTemplateHTSeries_aspx.html', 'utf8');

const target = "ASPx.createControl(ASPxClientGridView,'ContentPlaceHolder1_ASPxGridView1'";
const idx = html.indexOf(target);
if (idx !== -1) {
  console.log(html.substring(idx, idx + 1500));
} else {
  console.log('not found');
}
