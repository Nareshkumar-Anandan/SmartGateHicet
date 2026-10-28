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
  const menuMatch = p.match(/ASPxClientMenu[\s\S]*?\);/);
  if (menuMatch) console.log(menuMatch[0]);

  // Also check all script blocks
  const scripts = p.match(/<script[\s\S]*?<\/script>/gi) || [];
  scripts.forEach(s => {
    if (s.includes('ItemClick') || s.includes('ASPxMenu')) {
      console.log('--- Menu script ---');
      console.log(s);
    }
  });

  process.exit(0);
})();
