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

async function inspectDeletedAndEnrollment() {
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

  console.log('--- Checking DeletedUserDetails.aspx ---');
  const delPage = await get('/DeletedUserDetails.aspx', authCookie);
  const delRows = (delPage.body.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [])
    .map(r => (r.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [])
      .map(c => c.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim())
      .filter(Boolean)
    )
    .filter(cells => cells.length >= 2);
  console.log('Deleted rows count:', delRows.length);
  delRows.slice(0, 10).forEach(r => console.log('  ', r.join(' | ')));

  console.log('\n--- Checking OnlineEnrollment.aspx ---');
  const enrollPage = await get('/OnlineEnrollment.aspx', authCookie);
  console.log('EnrollPage size:', enrollPage.body.length);
  const enrollInputs = (enrollPage.body.match(/<input[^>]+id=["']([^"']+)["'][^>]*>/gi) || []).map(i => {
    const idMatch = i.match(/id=["']([^"']+)["']/i);
    const valMatch = i.match(/value=["']([^"']*)["']/i);
    return `${idMatch ? idMatch[1] : ''} = "${valMatch ? valMatch[1] : ''}"`;
  });
  enrollInputs.filter(i => !i.includes('VIEWSTATE')).forEach(i => console.log('  ', i));

  process.exit(0);
}

inspectDeletedAndEnrollment().catch(err => {
  console.error(err);
  process.exit(1);
});
