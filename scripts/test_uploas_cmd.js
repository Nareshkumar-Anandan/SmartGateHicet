const http = require('http');
const fs = require('fs');
const path = require('path');
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

function get(path, cookie) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '172.25.3.51', port: 9001, path, headers: { Cookie: cookie } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

(async () => {
  const cookie = await svc.login();
  const photoPath = path.resolve(__dirname, '../uploads/students/720826105011.jpg');
  const photoBuf = fs.readFileSync(photoPath);
  const dataUri = `data:image/jpeg;base64,${photoBuf.toString('base64')}`;

  console.log('1. Calling uploasClientClick for User 8 on IN1...');
  const res = await postJson('/DownloadUser.aspx/uploasClientClick', {
    data_uri_tmp: dataUri,
    mID: '8',
    mDevice: 'IN1',
    mName: 'Emmanuvel simson'
  }, cookie);
  console.log('uploasClientClick response:', res.status, res.body);

  console.log('2. Checking DeviceCommand.aspx for new commands...');
  const cmdPage = await get('/DeviceCommand.aspx', cookie);
  const rows = cmdPage.body.match(/<tr id="ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXDataRow\d+"[\s\S]*?<\/tr>/gi) || [];
  console.log('Top 5 commands:');
  rows.slice(0, 5).forEach((r, i) => console.log(`  ${i}: ` + r.replace(/<[^>]+>/g, ' | ').replace(/\s+/g, ' ').trim()));

  process.exit(0);
})();
