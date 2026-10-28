const svc = require('../src/services/timewatchIdmsService');
const http = require('http');

(async () => {
  const cookie = await svc.login();
  http.get({ hostname: '172.25.3.51', port: 9001, path: '/frmTemplateHTSeries.aspx', headers: { Cookie: cookie } }, res => {
    let b = '';
    res.on('data', c => b += c);
    res.on('end', () => {
      const rows = b.match(/<tr id="ContentPlaceHolder1_ASPxGridView1_DXDataRow\d+"[\s\S]*?<\/tr>/gi) || [];
      console.log('Total rows in frmTemplateHTSeries.aspx:', rows.length);
      rows.forEach((r, i) => {
        const cells = (r.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || []).map(c => c.replace(/<[^>]+>/g, '').trim());
        // typical cells: [select, uid, name, devname, enrolltype, devserial]
        const clean = cells.filter(Boolean);
        console.log(`[${i}]`, clean.join(' | '));
      });
      process.exit(0);
    });
  });
})();
