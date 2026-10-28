const fs = require('fs');

if (fs.existsSync('./scripts/page__TempManage_aspx.html')) {
  const html = fs.readFileSync('./scripts/page__TempManage_aspx.html', 'utf8');
  console.log('=== TempManage.aspx ===');
  const inputs = html.match(/<input[^>]+type="submit"[^>]*>/gi) || [];
  inputs.forEach(i => console.log(i));
}

if (fs.existsSync('./scripts/page__TemplateManagement_aspx.html')) {
  const html2 = fs.readFileSync('./scripts/page__TemplateManagement_aspx.html', 'utf8');
  console.log('\n=== TemplateManagement.aspx ===');
  const inputs2 = html2.match(/<input[^>]+type="submit"[^>]*>/gi) || [];
  inputs2.forEach(i => console.log(i));
}
