const http = require('http');

const endpoints = [
  '/ISAPI/System/deviceInfo',
  '/ISAPI/AccessControl/UserInfo/Record?format=json',
  '/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json',
  '/ISAPI/Security/userCheck',
  '/api/v1/user',
  '/cgi-bin/main-cgi',
  '/form/deviceInfo'
];

(async () => {
  for (const ep of endpoints) {
    await new Promise(r => {
      http.get({ hostname: '172.25.26.241', port: 80, path: ep }, res => {
        console.log(`Endpoint ${ep} => Status: ${res.statusCode}, Auth: ${res.headers['www-authenticate'] || 'none'}`);
        res.resume();
        r();
      }).on('error', err => {
        console.log(`Endpoint ${ep} => Error: ${err.message}`);
        r();
      });
    });
  }
  process.exit(0);
})();
