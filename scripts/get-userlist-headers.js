const http = require('http');
const svc = require('../src/services/timewatchIdmsService');

(async () => {
  const cookie = await svc.login();
  http.get({ hostname: '172.25.3.51', port: 9001, path: '/UserList.aspx', headers: { Cookie: cookie } }, res => {
    let b = '';
    res.on('data', c => b += c);
    res.on('end', () => {
      const headers = b.match(/<td[^>]*class="dxgvHeader[^"]*"[^>]*>([\s\S]*?)<\/td>/gi) || [];
      console.log('Headers:', headers.map(h => h.replace(/<[^>]+>/g, '').trim()).filter(Boolean));
      process.exit(0);
    });
  });
})();
