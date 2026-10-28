const fs = require('fs');

const pages = [
  'DownloadUser',
  'TempManage',
  'TemplateManagement',
  'UserManage',
  'frmTemplateHTSeries',
  'frmTemplatetZK'
];

for (const p of pages) {
  const file = `scripts/page__${p}_aspx.html`;
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, 'utf8');
  console.log(`\n================== ${p}.aspx ==================`);
  
  // Find visible buttons/links
  const buttons = (html.match(/<(?:input|button|a)[^>]+(?:type=["']submit["']|class=["'][^"']*dxbButton[^"']*["'])[^>]*>[\s\S]*?(?:<\/(?:button|a)>|(?=<))/gi) || [])
    .map(b => b.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  console.log('Buttons:', [...new Set(buttons)]);

  // Find labels/spans
  const textHeaders = (html.match(/<td[^>]*class=["']dxgvHeader[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi) || [])
    .map(h => h.replace(/<[^>]+>/g, '').trim())
    .filter(Boolean);
  if (textHeaders.length) console.log('Grid Headers:', textHeaders);
}
