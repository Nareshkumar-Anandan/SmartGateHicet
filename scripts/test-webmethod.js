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

function postJson(path, jsonBody, cookie = '') {
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
        ...(cookie ? { Cookie: cookie } : {})
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: data
      }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function postForm(path, bodyStr, cookie = '') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '172.25.3.51',
      port: 9001,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...(cookie ? { Cookie: cookie } : {})
      }
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

async function login() {
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

  const loginRes = await postForm('/Login.aspx', params.toString(), cookie);
  return loginRes.cookie || cookie;
}

async function run() {
  const cookie = await login();

  const dlPage = await get('/DownloadUser.aspx', cookie);
  const fs = require('fs');
  fs.writeFileSync('scripts/page__DownloadUser_aspx.html', dlPage.body);

  // Find GrdDevice items in client script
  const devItemsMatch = dlPage.body.match(/ASPxClientComboBox\('ContentPlaceHolder1_GrdDevice'[\s\S]*?\);/i) ||
                        dlPage.body.match(/items':\[(\{'value':[^\]]+\})\]/i);
  
  // Find text of all device options
  const devMatches = dlPage.body.match(/<td class="dxeListBoxItem_MetropolisBlue[^"]*">([^<]*)<\/td>/gi) || [];
  console.log('GrdDevice options:');
  devMatches.forEach(m => console.log('  ' + m.replace(/<[^>]+>/g, '').trim()));

  // Let's test with one of the uploaded student face photos!
  const photoPath = 'c:/Users/Nareshkumar/Documents/SmartGate/backend/uploads/students/720726106077.jpg';
  if (fs.existsSync(photoPath)) {
    const photoBuffer = fs.readFileSync(photoPath);
    const dataUri = `data:image/jpeg;base64,${photoBuffer.toString('base64')}`;
    console.log(`\nCalling uploasClientClick for 720726106077 (Photo size: ${photoBuffer.length} bytes)...`);

    const payload = {
      data_uri_tmp: dataUri,
      mID: '720726106077',
      mDevice: 'IN1', // or TW30000006260175
      mName: 'A.K.DHANUSHKUMAR'
    };

    const res = await postJson('/DownloadUser.aspx/uploasClientClick', payload, cookie);
    console.log('Result status:', res.status, 'Body:', res.body);

    // Now check DeviceCommand.aspx
    await new Promise(r => setTimeout(r, 1000));
    const cmdPage = await get('/DeviceCommand.aspx', cookie);
    const rows = cmdPage.body.match(/<tr id="ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXDataRow\d+"[\s\S]*?<\/tr>/gi) || [];
    console.log('Top 5 commands after upload:');
    rows.slice(0, 5).forEach((r, i) => {
      console.log(`  ${i}: ` + r.replace(/<[^>]+>/g, ' | ').replace(/\s+/g, ' ').trim());
    });
  } else {
    console.log('Photo not found at', photoPath);
  }
}

run().catch(console.error);
