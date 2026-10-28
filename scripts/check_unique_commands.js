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

  const html = await get('/DeviceCommand.aspx');
  // Find all description cells
  const descs = html.match(/<td[^>]*>[^<]*(?:User|Photo|Face|Data|Template|Enroll)[^<]*<\/td>/gi) || [];
  const clean = [...new Set(descs.map(d => d.replace(/<[^>]+>/g, '').trim()))];
  console.log('Unique command descriptions on DeviceCommand page 1:', clean);

  process.exit(0);
})();
