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
          console.log(`\n=================== ${page} ===================`);
          const inputs = (b.match(/<(input|select|textarea)[^>]*>/gi) || []).map(i => {
            const id = (i.match(/id=["']([^"']*)["']/) || [])[1] || '';
            const val = (i.match(/value=["']([^"']*)["']/) || [])[1] || '';
            const type = (i.match(/type=["']([^"']*)["']/) || [])[1] || '';
            return { id, val, type };
          }).filter(x => x.type !== 'hidden' && x.id);
          console.log('Inputs:', JSON.stringify(inputs, null, 2));

          const labels = (b.match(/<span[^>]*class=["']dxeBase[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi) || [])
            .map(s => s.replace(/<[^>]+>/g, '').trim())
            .filter(Boolean);
          console.log('Labels:', labels);
          resolve();
        });
      });
    });
  }
})();
