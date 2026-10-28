const http = require('http');

function get(path, cookie = '') {
  return new Promise((resolve, reject) => {
    const headers = cookie ? { 'Cookie': cookie } : {};
    http.get({ hostname: '172.25.3.51', port: 9001, path, headers }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body: data });
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

async function loginAndExplore() {
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

  console.log('--- 1. Fetching DeviceListHTSeries.aspx ---');
  const devicePage = await get('/DeviceListHTSeries.aspx', authCookie);
  console.log('Status:', devicePage.status, 'Length:', devicePage.body.length);

  // Extract navigation menu items / links
  const aspxLinks = Array.from(new Set(devicePage.body.match(/href=["']([^"']+\.aspx[^"']*)["']/gi) || []));
  console.log('\nNavigation Menu Links on iDMS:');
  aspxLinks.forEach(l => console.log('  ', l));

  // Extract device grid content / rows / table data
  console.log('\n--- Grid / Table text snippets ---');
  const tdTexts = devicePage.body.match(/<td[^>]*>([^<]{2,100})<\/td>/gi) || [];
  const cleanTds = tdTexts.map(t => t.replace(/<[^>]+>/g, '').trim()).filter(t => t && !t.includes('&nbsp;'));
  console.log('Visible Table Cells (' + cleanTds.length + '):');
  console.log(cleanTds.slice(0, 50));

  // Look for IP addresses and serial numbers
  const ips = devicePage.body.match(/\b(?:172|192|10)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g) || [];
  console.log('\nIPs found in page:', Array.from(new Set(ips)));

  const serials = devicePage.body.match(/\b(?:TW|AI|HT|SN)[\w\-]{5,25}\b/gi) || [];
  console.log('Possible Serials:', Array.from(new Set(serials)));

  process.exit(0);
}

loginAndExplore().catch(err => {
  console.error(err);
  process.exit(1);
});
