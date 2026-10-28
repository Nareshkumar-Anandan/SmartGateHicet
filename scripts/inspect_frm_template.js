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

  const p = await get('/frmTemplateHTSeries.aspx');
  const aspxBtns = p.match(/ASPxClientButton[\s\S]*?\);/g) || [];
  console.log('Buttons on frmTemplateHTSeries.aspx:');
  aspxBtns.forEach(b => console.log(b.slice(0, 150)));

  const inputs = p.match(/<input[^>]+submit[^>]*>/gi) || [];
  console.log('Submit inputs:');
  inputs.forEach(i => console.log(i));

  process.exit(0);
})();
