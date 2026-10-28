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

  const p = await get('/DownloadUser.aspx');
  const rows = p.match(/<tr id="ContentPlaceHolder1_grdDeviceU_DXDataRow\d+"[\s\S]*?<\/tr>/gi) || [];
  console.log(`Found ${rows.length} rows in grdDeviceU:`);
  rows.forEach((r, i) => {
    console.log(`Row ${i}: ` + r.replace(/<[^>]+>/g, ' | ').replace(/\s+/g, ' ').trim());
  });
  process.exit(0);
})();
