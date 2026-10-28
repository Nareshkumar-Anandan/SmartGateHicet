const http = require('http');
const fs = require('fs');
const svc = require('../src/services/timewatchIdmsService');

async function testWebMethod(pin, name, photoPath) {
  const cookie = await svc.login();
  const photoBuf = fs.readFileSync(photoPath);
  const dataUri = `data:image/jpeg;base64,${photoBuf.toString('base64')}`;

  const payload = JSON.stringify({
    data_uri_tmp: dataUri,
    mID: String(pin),
    mDevice: 'IN1',
    mName: name
  });

  console.log(`Sending WebMethod uploasClientClick for User ${pin} (${name}), photo size: ${photoBuf.length} bytes...`);

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '172.25.3.51',
      port: 9001,
      path: '/DownloadUser.aspx/uploasClientClick',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
        'Cookie': cookie
      }
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        console.log(`Status: ${res.statusCode}`);
        console.log(`Response: ${b}`);
        resolve({ status: res.statusCode, body: b });
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

(async () => {
  // Test for User 8: Navaneeth M
  await testWebMethod('8', 'Navaneeth M', 'backend/uploads/students/720726106077.jpg');
  // Test for User 9: RUTHRAN C
  await testWebMethod('9', 'RUTHRAN C', 'backend/uploads/students/720726109081.jpg');
})();
