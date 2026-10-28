const svc = require('../src/services/timewatchIdmsService');
const http = require('http');

(async () => {
  const cookie = await svc.login();
  function get(p) {
    return new Promise((resolve) => {
      http.get({ hostname: '172.25.3.51', port: 9001, path: p, headers: { Cookie: cookie } }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => resolve(d));
      });
    });
  }

  const p = await get('/Home.aspx');
  const aspx = p.match(/[\w\d]+\.aspx/gi) || [];
  console.log('ASPX pages found in Home.aspx:', [...new Set(aspx)]);
  process.exit(0);
})();
