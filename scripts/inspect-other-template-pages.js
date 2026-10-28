const svc = require('../src/services/timewatchIdmsService');
const http = require('http');

(async () => {
  const cookie = await svc.login();
  for (const page of ['/TempManage.aspx', '/TemplateManagement.aspx', '/frmTemplatetZK.aspx']) {
    await new Promise(resolve => {
      http.get({ hostname: '172.25.3.51', port: 9001, path: page, headers: { Cookie: cookie } }, res => {
        let b = '';
        res.on('data', c => b += c);
        res.on('end', () => {
          console.log(`\n=================== ${page} ===================`);
          const text = b.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                        .replace(/<[^>]+>/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();
          console.log(text.slice(0, 1000));
          resolve();
        });
      });
    });
  }
})();
