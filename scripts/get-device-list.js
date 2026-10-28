const svc = require('../src/services/timewatchIdmsService');
const http = require('http');

(async () => {
  const cookie = await svc.login();
  http.get({ hostname: '172.25.3.51', port: 9001, path: '/DeviceListHTseries.aspx', headers: { Cookie: cookie } }, res => {
    let b = '';
    res.on('data', c => b += c);
    res.on('end', () => {
      const rows = b.match(/<tr id="ContentPlaceHolder1_ASPxGridView1_DXDataRow\d+"[\s\S]*?<\/tr>/gi) || [];
      rows.forEach((r, i) => {
        console.log(`Device ${i}: ` + r.replace(/<[^>]+>/g, ' | ').replace(/\s+/g, ' ').trim());
      });
      process.exit(0);
    });
  });
})();
