const service = require('../src/services/timewatchIdmsService');
const http = require('http');
const querystring = require('querystring');
const fs = require('fs');

async function testExport() {
  const initPage = await service._authenticatedGet('/UserList.aspx');
  const viewstate = (initPage.body.match(/id="__VIEWSTATE"\s+value="([^"]+)"/) || [])[1] || '';
  const viewstateGen = (initPage.body.match(/id="__VIEWSTATEGENERATOR"\s+value="([^"]+)"/) || [])[1] || '';
  const eventVal = (initPage.body.match(/id="__EVENTVALIDATION"\s+value="([^"]+)"/) || [])[1] || '';

  const postData = querystring.stringify({
    '__VIEWSTATE': viewstate,
    '__VIEWSTATEGENERATOR': viewstateGen,
    '__EVENTVALIDATION': eventVal,
    'ctl00$ContentPlaceHolder1$ASPxButton2': 'Export'
  });

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '172.25.3.51',
      port: 9001,
      path: '/UserList.aspx',
      method: 'POST',
      headers: {
        'Cookie': service.sessionCookie,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 15000
    }, res => {
      console.log('Export response status:', res.statusCode);
      console.log('Content-Type:', res.headers['content-type']);
      console.log('Content-Disposition:', res.headers['content-disposition']);

      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        console.log('Downloaded bytes:', buf.length);
        fs.writeFileSync('scripts/exported_userlist_test.bin', buf);
        resolve(buf);
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

(async () => {
  try {
    await testExport();
  } catch (e) {
    console.error('Error:', e.message);
  }
  process.exit(0);
})();
