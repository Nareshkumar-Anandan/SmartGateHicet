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

  const tm = await get('/TemplateManagement.aspx');
  console.log('TemplateManagement.aspx length:', tm.length);
  const tmBtns = tm.match(/<[^>]+(button|submit|upload|btn)[^>]*>/gi) || [];
  tmBtns.forEach(b => console.log('  TM:', b));

  const tmpM = await get('/TempManage.aspx');
  console.log('TempManage.aspx length:', tmpM.length);
  const tmpMBtns = tmpM.match(/<[^>]+(button|submit|upload|btn)[^>]*>/gi) || [];
  tmpMBtns.forEach(b => console.log('  TmpM:', b));

  process.exit(0);
})();
