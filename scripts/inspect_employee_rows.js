const svc = require('../src/services/timewatchIdmsService');
const http = require('http');

(async () => {
  const cookie = await svc.login();
  function get(p) {
    return new Promise((resolve, reject) => {
      http.get({ hostname: '172.25.3.51', port: 9001, path: p, headers: { Cookie: cookie } }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => resolve(d));
      }).on('error', reject);
    });
  }

  const html = await get('/Employee.aspx');
  const rows = html.match(/<tr id="ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXDataRow\d+"[\s\S]*?<\/tr>/gi) || [];
  console.log(`Employee.aspx rows: ${rows.length}`);
  rows.forEach((r, i) => {
    const text = r.replace(/<[^>]+>/g, ' | ').replace(/\s+/g, ' ').trim();
    console.log(`Row ${i}: ${text}`);
  });

  process.exit(0);
})();
