const puppeteer = require('puppeteer-core');
const fs = require('fs');
const http = require('http');

function getEdgeExecutable() {
  const candidates = [
    process.env.EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
}

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

  const loginRes = await post('/Login.aspx', params.toString(), cookie);
  return loginRes.cookie || cookie;
}

async function run() {
  const cookieHeader = await login();
  const cookies = cookieHeader.split(';').map(c => {
    const [name, ...rest] = c.trim().split('=');
    return { name, value: rest.join('='), domain: '172.25.3.51', path: '/' };
  }).filter(c => c.name && c.value);

  const browser = await puppeteer.launch({
    executablePath: getEdgeExecutable(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setCookie(...cookies);

  page.on('dialog', async d => {
    console.log('Dialog:', d.message());
    await d.accept();
  });

  console.log('Navigating to DownloadUser.aspx...');
  await page.goto('http://172.25.3.51:9001/DownloadUser.aspx', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ContentPlaceHolder1_txtuserID_I');

  console.log('Entering User ID 8...');
  await page.click('#ContentPlaceHolder1_txtuserID_I');
  await page.type('#ContentPlaceHolder1_txtuserID_I', '8');
  
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {}),
    page.keyboard.press('Tab')
  ]);

  const name = await page.evaluate(() => {
    const el = document.getElementById('ContentPlaceHolder1_UserName_I');
    return el ? el.value : '';
  });
  console.log('User 8 Populated Name:', name);

  // Read student photo
  const photoPath = 'c:/Users/Nareshkumar/Documents/SmartGate/backend/uploads/students/720726106077.jpg';
  const photoBuffer = fs.readFileSync(photoPath);
  const dataUri = `data:image/jpeg;base64,${photoBuffer.toString('base64')}`;

  // Set data_uri_tmp
  await page.evaluate((uri) => {
    window.data_uri_tmp = uri;
    if (typeof UserPhoto !== 'undefined' && UserPhoto.SetImageUrl) {
      UserPhoto.SetImageUrl(uri);
    }
    const img = document.getElementById('ContentPlaceHolder1_UserPhoto');
    if (img) img.src = uri;
  }, dataUri);

  // Click Upload Camera Image
  console.log('Clicking Upload Camera Image...');
  await page.evaluate(() => {
    const btn = document.getElementById('ContentPlaceHolder1_btnUploadCmaera') ||
                document.getElementById('ContentPlaceHolder1_btnUploadCmaera_CD');
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 2000));

  // Select all turnstile devices in grdDeviceU
  console.log('Selecting all devices in grdDeviceU...');
  await page.evaluate(() => {
    const grid = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_grdDeviceU');
    if (grid) {
      grid.SelectAllRowsOnPage();
    }
  });
  await new Promise(r => setTimeout(r, 1000));

  // Click Upload button (ContentPlaceHolder1_btnUpload)
  console.log('Clicking ContentPlaceHolder1_btnUpload...');
  await page.evaluate(() => {
    const btn = document.getElementById('ContentPlaceHolder1_btnUpload') ||
                document.getElementById('ContentPlaceHolder1_btnUpload_CD');
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 4000));

  // Check top 5 commands in DeviceCommand.aspx!
  const cmdPage = await get('/DeviceCommand.aspx', cookieHeader);
  const rows = cmdPage.body.match(/<tr id="ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXDataRow\d+"[\s\S]*?<\/tr>/gi) || [];
  console.log('\nTop 5 commands in DeviceCommand.aspx:');
  rows.slice(0, 5).forEach((r, i) => {
    console.log(`  ${i}: ` + r.replace(/<[^>]+>/g, ' | ').replace(/\s+/g, ' ').trim());
  });

  await browser.close();
}

run().catch(console.error);
