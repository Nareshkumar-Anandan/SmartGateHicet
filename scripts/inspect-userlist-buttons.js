const svc = require('../src/services/timewatchIdmsService');
const http = require('http');

(async () => {
  const cookie = await svc.login();
  http.get({ hostname: '172.25.3.51', port: 9001, path: '/UserList.aspx', headers: { Cookie: cookie } }, res => {
    let b = '';
    res.on('data', c => b += c);
    res.on('end', () => {
      const aspxButtons = b.match(/ASPx\.createControl\(ASPxClientButton[\s\S]*?\);/gi) || [];
      console.log('UserList.aspx ASPxClientButtons count:', aspxButtons.length);
      aspxButtons.forEach(ab => {
        const name = ab.match(/'(ContentPlaceHolder1_[^']+)'/);
        console.log('  Button:', name ? name[1] : 'unknown');
      });
      process.exit(0);
    });
  });
})();
