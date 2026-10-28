const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'page__UploadExcel_aspx.html'), 'utf8');

// Find all controls
const ids = html.match(/id=["']ContentPlaceHolder1_[^"']+["']/g) || [];
const uniqueIds = [...new Set(ids.map(i => i.replace(/id=["']|["']/g, '')))];
console.log('UploadExcel Controls:\n', uniqueIds);

const m = html.match(/id=["']ContentPlaceHolder1_ASPxHyperLink1["'][^>]*href=["']([^"']*)["']/i) ||
          html.match(/href=["']([^"']*)["'][^>]*id=["']ContentPlaceHolder1_ASPxHyperLink1["']/i);
console.log('HyperLink href:', m ? m[1] : 'not found');
buttons.forEach(b => {
  const text = b.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  console.log('Button:', text);
});

// Also check frmTemplateHTSeries buttons & functions
const tmplHtml = fs.readFileSync(path.join(__dirname, 'page__frmTemplateHTSeries_aspx.html'), 'utf8');
const tmplButtons = tmplHtml.match(/<[^>]+(?:ASPxButton|Button|Submit)[^>]*>[\s\S]*?<\/[^>]+>/gi) || [];
console.log('\n--- Template HT Series Buttons ---');
tmplButtons.forEach(b => {
  const text = b.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  console.log('Button:', text);
});
