const http = require('http');

function get(path, cookie = '') {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '172.25.3.51', port: 9001, path, headers: cookie ? { Cookie: cookie } : {} }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

function post(path, bodyStr, cookie = '', isJson = false) {
  return new Promise((resolve, reject) => {
    const headers = {
      'Content-Type': isJson ? 'application/json; charset=utf-8' : 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(bodyStr),
      ...(cookie ? { Cookie: cookie } : {})
    };

    const req = http.request({
      hostname: '172.25.3.51',
      port: 9001,
      path,
      method: 'POST',
      headers
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: data,
        cookie: (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ')
      }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function extractVal(html, name) {
  const m = html.match(new RegExp(`name=["']${name}["'][^>]*value=["']([^"']*)["']`, 'i')) ||
            html.match(new RegExp(`value=["']([^"']*)["'][^>]*name=["']${name}["']`, 'i'));
  return m ? m[1] : '';
}

async function testUploadUserToMachine() {
  const initial = await get('/Login.aspx');
  const cookie = initial.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
  const viewState = extractVal(initial.body, '__VIEWSTATE');
  const viewStateGen = extractVal(initial.body, '__VIEWSTATEGENERATOR');

  const params = new URLSearchParams();
  params.append('__EVENTTARGET', 'ctl00$ContentPlaceHolder1$ASPxRoundPanel1$btnLogin');
  params.append('__VIEWSTATE', viewState);
  if (viewStateGen) params.append('__VIEWSTATEGENERATOR', viewStateGen);
  params.append('ctl00$ContentPlaceHolder1$ASPxRoundPanel1$cboDeviceType', 'AI Series');
  params.append('ContentPlaceHolder1_ASPxRoundPanel1_cboDeviceType_VI', 'H');
  params.append('ctl00$ContentPlaceHolder1$ASPxRoundPanel1$txtuser', 'admin');
  params.append('ctl00$ContentPlaceHolder1$ASPxRoundPanel1$txtPassword', 'admin');

  const loginRes = await post('/Login.aspx', params.toString(), cookie);
  const authCookie = loginRes.cookie || cookie;

  console.log('--- Calling PageMethods.uploasClientClick on DownloadUser.aspx ---');
  const payload = JSON.stringify({
    data_uri_tmp: '',
    mID: '8',
    mDevice: 'TW30000006260175',
    mName: 'Praveen Kumar'
  });

  const uploadRes = await post('/DownloadUser.aspx/uploasClientClick', payload, authCookie, true);
  console.log('Upload response status:', uploadRes.status);
  console.log('Upload response body:', uploadRes.body);

  process.exit(0);
}

testUploadUserToMachine().catch(err => {
  console.error(err);
  process.exit(1);
});
