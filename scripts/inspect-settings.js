const svc = require('../src/services/timewatchIdmsService');
const http = require('http');

(async () => {
  const cookie = await svc.login();
  for (const page of ['/CommonSetting.aspx', '/ParallelDB.aspx']) {
    await new Promise(resolve => {
      http.get({ hostname: '172.25.3.51', port: 9001, path: page, headers: { Cookie: cookie } }, res => {
        let b = '';
        res.on('data', c => b += c);
        res.on('end', () => {
          console.log(`\n=== ${page} body ===`);
          const idx = b.indexOf('main_div');
          console.log(b.substring(idx, idx + 1200).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
          resolve();
        });
      });
    });
  }
})();
