const http = require('http');
const svc = require('../src/services/timewatchIdmsService');

(async () => {
  const cookie = await svc.login();
  
  // Fetch DeviceCommand.aspx with page size 100 or all rows
  http.get({ hostname: '172.25.3.51', port: 9001, path: '/DeviceCommand.aspx', headers: { Cookie: cookie } }, res => {
    let b = '';
    res.on('data', c => b += c);
    res.on('end', () => {
      const rows = b.match(/<tr id="ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXDataRow\d+"[\s\S]*?<\/tr>/gi) || [];
      console.log(`Total command rows on page: ${rows.length}`);
      
      const parsed = rows.map(r => {
        const cells = (r.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || []).map(c => c.replace(/<[^>]+>/g, '').trim());
        return cells;
      });

      // Filter for unique descriptions
      const descriptions = [...new Set(parsed.map(p => p[7]))];
      console.log('Unique command descriptions:', descriptions);

      // Print any rows with Face or photo or template
      const faceCmds = parsed.filter(p => p.some(c => /face|photo|template|bio|image/i.test(c)));
      console.log(`Commands containing face/photo/template (${faceCmds.length}):`);
      faceCmds.forEach(c => console.log('  ', c.join(' | ')));

      process.exit(0);
    });
  });
})();
