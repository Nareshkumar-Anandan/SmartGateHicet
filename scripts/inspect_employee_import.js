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

  const html = await get('/Employee.aspx');
  // Find Browse or Import or UploadControl
  const matches = html.match(/<[^>]+(?:Import|Browse|UploadControl|file)[^>]*>[\s\S]*?<\/[^>]+>/gi) || [];
  console.log(`Found ${matches.length} elements`);
  matches.forEach(m => console.log(m.slice(0, 200)));

  // Also find all input tags with type="file" or id containing Import
  const inputs = html.match(/<input[^>]*>/gi) || [];
  inputs.forEach(i => {
    if (i.includes('file') || i.includes('Import') || i.includes('Browse') || i.includes('Upload')) {
      console.log('INPUT:', i);
    }
  });

  process.exit(0);
})();
