const fs = require('fs');

const html = fs.readFileSync('scripts/page__DeviceCommand_aspx.html', 'utf8');

// Find the headers of the grid
const headers = html.match(/<td[^>]*class="[^"]*dxgvHeader[^"]*"[^>]*>([\s\S]*?)<\/td>/gi) || [];
console.log('Headers:');
headers.forEach(h => console.log('  ' + h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()));

// Find row 0 td cells
const row0 = html.match(/<tr id="ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXDataRow0"[\s\S]*?<\/tr>/i);
if (row0) {
  const cells = row0[0].match(/<td[\s\S]*?<\/td>/gi) || [];
  console.log(`\nRow 0 (${cells.length} cells):`);
  cells.forEach((c, i) => console.log(`  Cell ${i}:`, c.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()));
}
