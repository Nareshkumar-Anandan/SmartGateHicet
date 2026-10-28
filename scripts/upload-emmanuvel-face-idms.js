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
  console.log('Reading photo from:', photoPath);
  const photoBuf = fs.readFileSync(photoPath);
  console.log(`Photo size: ${photoBuf.length} bytes`);
  const dataUri = `data:image/jpeg;base64,${photoBuf.toString('base64')}`;

  console.log('Posting uploasClientClick with mID: "8", mName: "Emmanuvel simson", mDevice: "IN1"...');
  const res = await postJson('/DownloadUser.aspx/uploasClientClick', {
    data_uri_tmp: dataUri,
    mID: '8',
    mDevice: 'IN1',
    mName: 'Emmanuvel simson'
  }, cookie);
  console.log('uploasClientClick result:', res.status, res.body);

  // Now check frmTemplateHTSeries.aspx to see if Enrollment Type changed for 8!
  const tmpl = await get('/frmTemplateHTSeries.aspx', cookie);
  const rows = tmpl.body.match(/<tr id="ContentPlaceHolder1_ASPxGridView1_DXDataRow\d+"[\s\S]*?<\/tr>/gi) || [];
  console.log('\n--- Checking frmTemplateHTSeries for User 8 ---');
  rows.forEach((r, i) => {
    const text = r.replace(/<[^>]+>/g, ' | ').replace(/\s+/g, ' ').trim();
    if (text.includes('| 8 |')) {
      console.log(`Row ${i}: ${text}`);
    }
  });

  // Also check UserPhoto.aspx!
  const up = await get('/UserPhoto.aspx', cookie);
  const upRows = up.body.match(/<tr id="ContentPlaceHolder1_ASPxGridView1_DXDataRow\d+"[\s\S]*?<\/tr>/gi) || [];
  console.log('\n--- Checking UserPhoto.aspx for User 8 ---');
  upRows.forEach((r, i) => {
    const text = r.replace(/<[^>]+>/g, ' | ').replace(/\s+/g, ' ').trim();
    if (text.includes('| 8 |')) {
      console.log(`UserPhoto Row ${i}: ${text}`);
    }
  });
  
  process.exit(0);
})();
