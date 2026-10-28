const fs = require('fs');
const html = fs.readFileSync('scripts/page__frmTemplateHTSeries_aspx.html', 'utf8');
const lines = html.split('\n');
lines.forEach((l, i) => {
  if (l.includes('ASPxButton3') || l.includes('Image') || l.includes('passCheck') || l.includes('Popup')) {
    console.log(`Line ${i}: ${l.slice(0, 150)}`);
  }
});
