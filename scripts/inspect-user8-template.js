const svc = require('../src/services/timewatchIdmsService');
const http = require('http');

(async () => {
  const cookie = await svc.login();
  http.get({ hostname: '172.25.3.51', port: 9001, path: '/frmTemplateHTSeries.aspx', headers: { Cookie: cookie } }, res => {
    let b = '';
    res.on('data', c => b += c);
    res.on('end', () => {
      const rows = b.match(/<tr id="ContentPlaceHolder1_ASPxGridView1_DXDataRow\d+"[\s\S]*?<\/tr>/gi) || [];
      console.log('Total rows:', rows.length);
      rows.forEach((r, i) => {
        const text = r.replace(/<[^>]+>/g, ' | ').replace(/\s+/g, ' ').trim();
        if (text.includes('| 8 |') || text.includes('| 10 |') || text.includes('| 11 |') || text.toLowerCase().includes('navaneeth') || text.toLowerCase().includes('kavitha') || text.toLowerCase().includes('emmanuvel')) {
          console.log(`Row ${i}: ${text}`);
        }
      });
      process.exit(0);
    });
  });
})();
