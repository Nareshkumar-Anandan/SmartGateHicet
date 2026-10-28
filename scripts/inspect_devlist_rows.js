const fs = require('fs');
const html = fs.readFileSync('scripts/page__DeviceListHTseries_aspx.html', 'utf8');

const rows = html.match(/<tr id="ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXDataRow\d+"[\s\S]*?<\/tr>/gi) || [];
console.log('Rows count:', rows.length);
rows.forEach((r, i) => {
  const cells = (r.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || []).map(c => c.replace(/<[^>]+>/g, '').trim());
  console.log('DEV ' + i + ':', cells.slice(0, 10).join(' | '));
});
