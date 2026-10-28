const http = require('http');

function get(path, cookie = '') {
  return new Promise((resolve, reject) => {
    const headers = cookie ? { 'Cookie': cookie } : {};
    http.get({ hostname: '172.25.3.51', port: 9001, path, headers }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

function post(path, bodyStr, cookie = '') {
  return new Promise((resolve, reject) => {
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(bodyStr)
    };
    if (cookie) headers['Cookie'] = cookie;

    const req = http.request({ hostname: '172.25.3.51', port: 9001, path, method: 'POST', headers }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const setCookie = res.headers['set-cookie'];
        let updatedCookie = cookie;
        if (setCookie) {
          const added = setCookie.map(c => c.split(';')[0]).join('; ');
          updatedCookie = cookie ? `${cookie}; ${added}` : added;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: data, cookie: updatedCookie });
      });
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

async function inspectParallelDB() {
  const initial = await get('/Login.aspx');
  const cookie = initial.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
  const viewState = extractVal(initial.body, '__VIEWSTATE');
  const viewStateGen = extractVal(initial.body, '__VIEWSTATEGENERATOR');

  const params = new URLSearchParams();
  params.append('__EVENTTARGET', 'ctl00$ContentPlaceHolder1$ASPxRoundPanel1$btnLogin');
  params.append('__EVENTARGUMENT', '');
  params.append('__VIEWSTATE', viewState);
  if (viewStateGen) params.append('__VIEWSTATEGENERATOR', viewStateGen);
  params.append('ctl00$ContentPlaceHolder1$ASPxRoundPanel1$cboDeviceType', 'AI Series');
  params.append('ContentPlaceHolder1_ASPxRoundPanel1_cboDeviceType_VI', 'H');
  params.append('ctl00$ContentPlaceHolder1$ASPxRoundPanel1$txtuser', 'admin');
  params.append('ctl00$ContentPlaceHolder1$ASPxRoundPanel1$txtPassword', 'admin');

  const loginRes = await post('/Login.aspx', params.toString(), cookie);
  const authCookie = loginRes.cookie || cookie;

  const pdb = await get('/ParallelDB.aspx', authCookie);
  console.log('ParallelDB body length:', pdb.body.length);

  const inputs = (pdb.body.match(/<input[^>]+>/gi) || []).map(i => {
    const id = i.match(/id=["']([^"']+)["']/i);
    const val = i.match(/value=["']([^"']*)["']/i);
    return `${id ? id[1] : 'unknown'}: "${val ? val[1] : ''}"`;
  });
  console.log('ParallelDB inputs:');
  inputs.filter(i => !i.includes('VIEWSTATE')).forEach(i => console.log('  ', i));

  process.exit(0);
}

inspectParallelDB().catch(err => {
  console.error(err);
  process.exit(1);
});
