const http = require('http');
const svc = require('../src/services/timewatchIdmsService');

function postJson(path, jsonBody, cookie) {
  const bodyStr = JSON.stringify(jsonBody);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '172.25.3.51',
      port: 9001,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(bodyStr),
        'Cookie': cookie
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

(async () => {
  const cookie = await svc.login();
  
  // Test 1: Empty data_uri_tmp
  const t1 = await postJson('/DownloadUser.aspx/uploasClientClick', {
    data_uri_tmp: '',
    mID: '8',
    mDevice: 'IN1',
    mName: 'Emmanuvel simson'
  }, cookie);
  console.log('Test 1 (empty uri):', t1.status, t1.body);

  // Test 2: Invalid base64
  const t2 = await postJson('/DownloadUser.aspx/uploasClientClick', {
    data_uri_tmp: 'data:image/jpeg;base64,not-valid-base64!!!',
    mID: '8',
    mDevice: 'IN1',
    mName: 'Emmanuvel simson'
  }, cookie);
  console.log('Test 2 (invalid base64):', t2.status, t2.body);

  // Test 3: Raw base64 without prefix
  const t3 = await postJson('/DownloadUser.aspx/uploasClientClick', {
    data_uri_tmp: '1234',
    mID: '8',
    mDevice: 'IN1',
    mName: 'Emmanuvel simson'
  }, cookie);
  console.log('Test 3 (raw base64):', t3.status, t3.body);

  process.exit(0);
})();
