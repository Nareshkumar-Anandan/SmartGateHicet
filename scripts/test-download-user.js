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

async function testDownloadUser() {
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

  console.log('Fetching UserManage.aspx...');
  const page = await get('/UserManage.aspx', authCookie);
  console.log('Status:', page.status, 'Body length:', page.body.length);
  
  const buttons = (page.body.match(/<[^>]+(btn|Button|Submit|Download|Upload|Clear|Delete)[^>]*>/gi) || [])
    .filter(b => !b.includes('VIEWSTATE'));
  console.log('Buttons/Inputs on UserManage.aspx:');
  buttons.forEach(b => console.log('  ', b));

  const allInputs = (page.body.match(/<input[^>]+id=["']([^"']+)["'][^>]*>/gi) || []).map(i => {
    const idMatch = i.match(/id=["']([^"']+)["']/i);
    const valMatch = i.match(/value=["']([^"']*)["']/i);
    const typeMatch = i.match(/type=["']([^"']+)["']/i);
    return `${typeMatch ? typeMatch[1] : 'text'}: ${idMatch ? idMatch[1] : ''} = "${valMatch ? valMatch[1] : ''}"`;
  });
  console.log('All input IDs on UserManage.aspx:');
  allInputs.filter(i => !i.includes('VIEWSTATE')).forEach(i => console.log('  ', i));

  process.exit(0);
}

testDownloadUser().catch(console.error);
