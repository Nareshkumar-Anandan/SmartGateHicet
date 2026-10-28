const http = require('http');

http.get('http://172.25.26.241/cgi-bin/magicBox.cgi?action=getSystemInfo', (res) => {
  console.log('Status code:', res.statusCode);
  console.log('Auth header:', res.headers['www-authenticate']);
}).on('error', err => {
  console.error(err);
});
