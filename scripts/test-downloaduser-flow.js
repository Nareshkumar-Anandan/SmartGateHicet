const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
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
  console.log('Logged in to iDMS. Cookie:', cookieHeader);

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
  await page.setViewport({ width: 1280, height: 900 });
  await page.setCookie(...cookies);

  page.on('dialog', async d => {
    console.log('Dialog appeared:', d.type(), d.message());
    await d.accept();
  });

  page.on('console', msg => console.log('Browser console:', msg.text()));

  console.log('Navigating to DownloadUser.aspx...');
  await page.goto('http://172.25.3.51:9001/DownloadUser.aspx', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForSelector('#ContentPlaceHolder1_txtuserID_I', { timeout: 10000 });

  // Read student photo
  const photoPath = 'c:/Users/Nareshkumar/Documents/SmartGate/backend/uploads/students/720726106077.jpg';
  const photoBuffer = fs.readFileSync(photoPath);
  const dataUri = `data:image/jpeg;base64,${photoBuffer.toString('base64')}`;

  console.log('Filling form for 720726106077...');
  // Fill User ID & Wait for AutoPostBack!
  await page.click('#ContentPlaceHolder1_txtuserID_I');
  await page.type('#ContentPlaceHolder1_txtuserID_I', '720726106077');
  
  // Trigger blur / change which causes autoPostBack
  console.log('Triggering AutoPostBack for txtuserID...');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }),
    page.keyboard.press('Tab')
  ]);
  console.log('AutoPostBack completed!');

  // Check what UserName was populated
  const populatedName = await page.evaluate(() => {
    const el = document.getElementById('ContentPlaceHolder1_UserName_I');
    return el ? el.value : '';
  });
  console.log('Populated UserName from AutoPostBack:', populatedName);

  if (!populatedName) {
    await page.click('#ContentPlaceHolder1_UserName_I');
    await page.type('#ContentPlaceHolder1_UserName_I', 'A.K.DHANUSHKUMAR');
  }

  // Select Device IN1 if not selected
  await page.evaluate(() => {
    const devInput = document.getElementById('ContentPlaceHolder1_GrdDevice_I');
    if (devInput && !devInput.value) devInput.value = 'IN1';
    const devVi = document.getElementById('ContentPlaceHolder1_GrdDevice_VI');
    if (devVi && !devVi.value) devVi.value = 'IN1';
  });

  page.on('requestfailed', req => {
    console.log('Failed request:', req.url(), req.failure().errorText);
  });
  page.on('response', res => {
    if (res.url().includes('DownloadUser') || res.url().includes('Upload') || res.url().includes('axd')) {
      console.log('Response:', res.status(), res.url().slice(0, 80));
    }
  });

  // Set data_uri_tmp in page context
  await page.evaluate((uri) => {
    window.data_uri_tmp = uri;
    if (typeof UserPhoto !== 'undefined' && UserPhoto.SetImageUrl) {
      UserPhoto.SetImageUrl(uri);
    }
    const img = document.getElementById('ContentPlaceHolder1_UserPhoto');
    if (img) img.src = uri;
  }, dataUri);

  // Click btnUploadCmaera (Upload Camera Image)
  console.log('Clicking Upload Camera Image (ContentPlaceHolder1_btnUploadCmaera)...');
  await page.evaluate(() => {
    const btn = document.getElementById('ContentPlaceHolder1_btnUploadCmaera') ||
                document.getElementById('ContentPlaceHolder1_btnUploadCmaera_CD');
    if (btn) btn.click();
  });

  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: 'scripts/downloaduser_after_uploadcamera.png' });

  // Select all target devices in grdDeviceU using DevExpress API and direct clicking
  console.log('Selecting all target devices in grdDeviceU...');
  await page.evaluate(() => {
    const grid = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_grdDeviceU');
    if (grid) {
      grid.SelectAllRowsOnPage();
    }
  });
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: 'scripts/downloaduser_devices_selected.png' });

  // Now click btnUpload (Upload)
  console.log('Clicking Upload button (ContentPlaceHolder1_btnUpload)...');
  await page.evaluate(() => {
    const btn = document.getElementById('ContentPlaceHolder1_btnUpload') ||
                document.getElementById('ContentPlaceHolder1_btnUpload_CD');
    if (btn) btn.click();
  });

  await new Promise(r => setTimeout(r, 5000));
  await page.screenshot({ path: 'scripts/downloaduser_after_upload.png' });

  const finalHtml = await page.content();
  fs.writeFileSync('scripts/downloaduser_postback_result.html', finalHtml);

  const statusText = await page.evaluate(() => {
    const lbl = document.getElementById('ContentPlaceHolder1_lblStatus');
    const allLabels = Array.from(document.querySelectorAll('span, div, p')).map(el => el.innerText).filter(t => t && (t.includes('Success') || t.includes('Error') || t.includes('Failed') || t.includes('Uploaded') || t.includes('Record')));
    return {
      statusLbl: lbl ? lbl.innerText : '',
      otherLabels: allLabels.slice(0, 5)
    };
  });
  console.log('Status result:', statusText);

  // Check DeviceCommand.aspx top rows
  const cmdPage = await get('/DeviceCommand.aspx', cookieHeader);
  const rows = cmdPage.body.match(/<tr id="ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXDataRow\d+"[\s\S]*?<\/tr>/gi) || [];
  console.log('\nTop 5 commands in DeviceCommand.aspx:');
  rows.slice(0, 5).forEach((r, i) => {
    console.log(`  ${i}: ` + r.replace(/<[^>]+>/g, ' | ').replace(/\s+/g, ' ').trim());
  });

  await browser.close();
}

run().catch(console.error);
