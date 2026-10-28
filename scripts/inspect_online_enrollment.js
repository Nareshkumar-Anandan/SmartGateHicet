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

  const html = await get('/OnlineEnrollment.aspx');
  console.log('OnlineEnrollment status: len =', html.length);
  // Find all input, button, select elements
  const inputs = html.match(/<(?:input|button|select|textarea)[^>]*>/gi) || [];
  inputs.forEach(i => console.log('  ', i));
  
  // Find script texts
  const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
  scripts.forEach(s => {
    if (s.includes('function') && !s.includes('dxis_') && !s.includes('dxss_')) {
      console.log('Script:', s.slice(0, 300));
    }
  });

  process.exit(0);
})();
