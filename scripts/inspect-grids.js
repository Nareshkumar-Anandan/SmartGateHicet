const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'page__frmTemplateHTSeries_aspx.html'), 'utf8');

// Find all tables or headers in GridView1 and GridView2
const rows1 = html.match(/<tr id="ContentPlaceHolder1_ASPxGridView1_DXDataRow\d+"[\s\S]*?<\/tr>/gi) || [];
console.log(`GridView1 data rows (${rows1.length}):`);
rows1.slice(0, 10).forEach((r, i) => {
  console.log(`  Row ${i}:`, r.replace(/<[^>]+>/g, ' | ').replace(/\s+/g, ' ').trim());
});

const rows2 = html.match(/<tr id="ContentPlaceHolder1_ASPxGridView2_DXDataRow\d+"[\s\S]*?<\/tr>/gi) || [];
console.log(`GridView2 data rows (${rows2.length}):`);
rows2.slice(0, 10).forEach((r, i) => {
  console.log(`  Row ${i}:`, r.replace(/<[^>]+>/g, ' | ').replace(/\s+/g, ' ').trim());
});
