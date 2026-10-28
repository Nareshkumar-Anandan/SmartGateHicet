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

async function inspectEmployeePage() {
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

  console.log('--- Fetching Employee.aspx ---');
  const page = await get('/Employee.aspx', authCookie);
  console.log('Employee.aspx status:', page.status, 'size:', page.body.length);

  // Find all inputs on Employee.aspx
  const inputs = (page.body.match(/<input[^>]+>/gi) || []).map(i => i.trim());
  console.log('Inputs on Employee.aspx:');
  inputs.filter(i => !i.includes('VIEWSTATE')).forEach(i => console.log('  ', i));

  // Find buttons
  const buttons = (page.body.match(/<[^>]+(btn|Button|Save|Submit|Add)[^>]*>/gi) || [])
    .filter(b => !b.includes('VIEWSTATE'));
  console.log('\nButtons on Employee.aspx:');
  buttons.forEach(b => console.log('  ', b));

  process.exit(0);
}

inspectEmployeePage().catch(err => {
  console.error(err);
  process.exit(1);
});
