const puppeteer = require('puppeteer-core');
const fs = require('fs');
const http = require('http');

function getEdgeExecutable() {
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

  let lastDialog = '';
  page.on('dialog', async d => {
    lastDialog = d.message();
    console.log('[DIALOG]', lastDialog);
    await d.accept();
  });

  console.log('Navigating to DownloadUser.aspx...');
  await page.goto('http://172.25.3.51:9001/DownloadUser.aspx', { waitUntil: 'networkidle0' });

  // Read student photo for Navaneeth (8)
  const photoPath = 'c:/Users/Nareshkumar/Documents/SmartGate/backend/uploads/students/720726106077.jpg';
  const photoBuffer = fs.readFileSync(photoPath);
  const dataUri = `data:image/jpeg;base64,${photoBuffer.toString('base64')}`;

  console.log('1. Setting Form fields for User 8 (Navaneeth M)...');
  await page.evaluate(() => {
    const dev = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_GrdDevice');
    if (dev) {
      dev.SetText('IN1');
      dev.SetValue('IN1');
    }
    const user = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_txtuserID');
    if (user) {
      user.SetText('8');
      user.SetValue('8');
    }
    const name = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_UserName');
    if (name) {
      name.SetText('Navaneeth M');
      name.SetValue('Navaneeth M');
    }
    const img = ASPxClientControl.GetControlCollection().GetByName('UserPhoto');
    if (img) {
      img.SetImageUrl('data:image/jpeg;base64,...');
    }
  });

  console.log('2. Calling PageMethods.uploasClientClick...');
  const uploadRes = await page.evaluate(async (uri) => {
    return new Promise((resolve) => {
      PageMethods.uploasClientClick(uri, '8', 'IN1', 'Navaneeth M', (res) => {
        resolve({ success: true, res });
      }, (err) => {
        resolve({ success: false, err: err ? err.get_message() : 'Unknown error' });
      });
    });
  }, dataUri);
  console.log('Upload client click result:', uploadRes);

  console.log('3. Selecting all devices in grdDeviceU...');
  await page.evaluate(() => {
    const grid = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_grdDeviceU');
    if (grid) {
      grid.SelectAllRowsOnPage();
    }
  });
  await new Promise(r => setTimeout(r, 1500));

  const selectedCount = await page.evaluate(() => {
    const grid = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_grdDeviceU');
    return grid ? grid.GetSelectedRowCount() : -1;
  });
  console.log('Selected turnstiles count:', selectedCount);

  console.log('4. Clicking ContentPlaceHolder1_btnUpload via DoClick()...');
  const postPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(e => console.log('Navigation timeout/skipped'));
  
  await page.evaluate(() => {
    const btn = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_btnUpload');
    if (btn) {
      btn.DoClick();
    } else {
      document.getElementById('ContentPlaceHolder1_btnUpload_I').click();
    }
  });

  await postPromise;
  await new Promise(r => setTimeout(r, 3000));

  const afterHtml = await page.content();
  const alertText = await page.evaluate(() => {
    const el = document.getElementById('ContentPlaceHolder1_lblStatus') || document.body;
    return el.innerText;
  });
  console.log('Dialog:', lastDialog);
  console.log('Page text snippet after upload:', alertText.slice(0, 500));

  // Check top 10 commands in DeviceCommand.aspx!
  const cmdPage = await get('/DeviceCommand.aspx', cookieHeader);
  const rows = cmdPage.body.match(/<tr id="ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXDataRow\d+"[\s\S]*?<\/tr>/gi) || [];
  console.log('\nTop 10 commands in DeviceCommand.aspx:');
  rows.slice(0, 10).forEach((r, i) => {
    console.log(`  ${i}: ` + r.replace(/<[^>]+>/g, ' | ').replace(/\s+/g, ' ').trim());
  });

  await browser.close();
}

run().catch(console.error);
