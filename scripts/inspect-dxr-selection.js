const http = require('http');
const fs = require('fs');

function get(path, cookie = '') {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '172.25.3.51', port: 9001, path, headers: cookie ? { Cookie: cookie } : {} }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
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

async function run() {
  const initial = await get('/Login.aspx');
  const cookie = initial.headers ? initial.headers['set-cookie'] : '';
  const viewState = extractVal(initial, '__VIEWSTATE');
  const viewStateGen = extractVal(initial, '__VIEWSTATEGENERATOR');

  const params = new URLSearchParams();
  params.append('__EVENTTARGET', 'ctl00$ContentPlaceHolder1$ASPxRoundPanel1$btnLogin');
  params.append('__VIEWSTATE', viewState);
  if (viewStateGen) params.append('__VIEWSTATEGENERATOR', viewStateGen);
  params.append('ctl00$ContentPlaceHolder1$ASPxRoundPanel1$cboDeviceType', 'AI Series');
  params.append('ContentPlaceHolder1_ASPxRoundPanel1_cboDeviceType_VI', 'H');
  params.append('ctl00$ContentPlaceHolder1$ASPxRoundPanel1$txtuser', 'admin');
  params.append('ctl00$ContentPlaceHolder1$ASPxRoundPanel1$txtPassword', 'admin');

  const loginRes = await post('/Login.aspx', params.toString());
  const authCookie = loginRes.cookie;

  const page = await new Promise((res, rej) => {
    http.get({ hostname: '172.25.3.51', port: 9001, path: '/Employee.aspx', headers: { Cookie: authCookie } }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => res(d));
    }).on('error', rej);
  });
  const dxrMatches = [...page.matchAll(/src=["']([^"']*DXR\.axd[^"']*)["']/gi)].map(m => m[1]);
  console.log('DXR script URLs:', dxrMatches);

  for (const url of dxrMatches) {
    console.log('Fetching', url);
    const content = await get(url);
    console.log('Length:', content.length);

    // Search for selection state handling
    const selMatches = content.match(/[\w\.]*selection[\w\.]*\s*=/gi) || [];
    console.log('Selection matches:', selMatches.slice(0, 10));

    // Search for hidden input names created for grid
    const hiddenNames = content.match(/["']([a-zA-Z0-9_\$]*Sel[a-zA-Z0-9_\$]*)["']/gi) || [];
    console.log('Sel hidden names:', [...new Set(hiddenNames)].slice(0, 20));
  }
}

run();
