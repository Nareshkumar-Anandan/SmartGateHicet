const http = require('http');

async function testPort80() {
  console.log('Testing http://172.25.3.51:80/ ...');
  
  const testUrls = [
    '/',
    '/TimeWatchAPI',
    '/TimeWatchAPI/GetDeviceList',
    '/api',
    '/iclock/cdata'
  ];

  for (const p of testUrls) {
    try {
      await new Promise(resolve => {
        http.get({ hostname: '172.25.3.51', port: 80, path: p, timeout: 3000 }, res => {
          let body = '';
          res.on('data', c => body += c);
          res.on('end', () => {
            console.log(`Path ${p} -> HTTP ${res.statusCode} (length: ${body.length}, server: ${res.headers.server || 'unknown'})`);
            if (body.length < 200) console.log('  Body:', body.trim());
            resolve();
          });
        }).on('error', err => {
          console.log(`Path ${p} -> Error: ${err.message}`);
          resolve();
        });
      });
    } catch {}
  }
  process.exit(0);
}

testPort80();
