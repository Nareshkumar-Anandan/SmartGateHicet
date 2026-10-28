const http = require('http');

function testEndpoint(path) {
  return new Promise(resolve => {
    http.get(`http://172.25.26.241${path}`, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ path, status: res.statusCode, headers: res.headers, body: data.slice(0, 150) }));
    }).on('error', err => resolve({ path, error: err.message }));
  });
}

async function run() {
  const tests = [
    '/cgi-bin/configManager.cgi?action=getConfig&name=General',
    '/cgi-bin/AccessFace.cgi',
    '/cgi-bin/AccessUser.cgi',
    '/cgi-bin/recordFinder.cgi',
    '/ISAPI/Security/userCheck',
    '/api/v1/user',
    '/api/face',
    '/iclock/cdata'
  ];

  for (const t of tests) {
    const res = await testEndpoint(t);
    console.log(res.path, '-> Status:', res.status, res.headers ? res.headers['www-authenticate'] || '' : '');
  }
}

run();
