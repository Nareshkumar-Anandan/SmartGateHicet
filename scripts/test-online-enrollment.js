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

function post(path, bodyStr, cookie = '') {
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

async function testOnlineEnrollment() {
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

  const page = await get('/OnlineEnrollment.aspx', authCookie);
  console.log('OnlineEnrollment size:', page.body.length);

  // Look for form action, javascript around btnUploadOffline
  const scripts = (page.body.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [])
    .filter(s => s.includes('btnUploadOffline') || s.includes('Enroll') || s.includes('txtuserID'));

  scripts.forEach((s, i) => {
    console.log(`\n--- Script ${i+1} ---`);
    console.log(s.slice(0, 500));
  });

  const pageViewState = extractVal(page.body, '__VIEWSTATE');
  const pageViewStateGen = extractVal(page.body, '__VIEWSTATEGENERATOR');
  const pageEventVal = extractVal(page.body, '__EVENTVALIDATION');

  console.log('\n--- Submitting OnlineEnrollment for User 8 (Praveen Kumar) to TW30000006260175 ---');
  const postParams = new URLSearchParams();
  postParams.append('__VIEWSTATE', pageViewState);
  if (pageViewStateGen) postParams.append('__VIEWSTATEGENERATOR', pageViewStateGen);
  if (pageEventVal) postParams.append('__EVENTVALIDATION', pageEventVal);
  postParams.append('ctl00$ContentPlaceHolder1$radTF', 'C');
  postParams.append('ContentPlaceHolder1_radTF_S', 'C');
  postParams.append('ctl00$ContentPlaceHolder1$GrdDevice', 'IN1');
  postParams.append('ContentPlaceHolder1_GrdDevice_VI', 'TW30000006260175');
  postParams.append('ctl00$ContentPlaceHolder1$txtuserID', '8');
  postParams.append('ctl00$ContentPlaceHolder1$UserName', 'Praveen Kumar');
  postParams.append('ctl00$ContentPlaceHolder1$CardNum', '');
  postParams.append('ctl00$ContentPlaceHolder1$Password', '');
  postParams.append('ctl00$ContentPlaceHolder1$radFace', 'C');
  postParams.append('ContentPlaceHolder1_radFace_S', 'C');
  postParams.append('ctl00$ContentPlaceHolder1$btnUploadOffline', 'Enroll');

  const enrollRes = await post('/OnlineEnrollment.aspx', postParams.toString(), authCookie);
  console.log('Enroll status:', enrollRes.status);
  const alerts = enrollRes.body.match(/alert\([^)]+\)/gi) || [];
  console.log('Alerts:', alerts);

  process.exit(0);
}

testOnlineEnrollment().catch(err => {
  console.error(err);
  process.exit(1);
});
