const puppeteer = require('puppeteer-core');
const fs = require('fs');

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
  await page.setViewport({ width: 1280, height: 900 });
  await page.setCookie(...cookies);

  page.on('dialog', async d => {
    console.log('Dialog:', d.message());
    await d.accept();
  });

  console.log('Navigating to frmTemplateHTSeries.aspx...');
  await page.goto('http://172.25.3.51:9001/frmTemplateHTSeries.aspx', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ContentPlaceHolder1_ASPxButton1', { timeout: 10000 });

  // Select row 0 in GridView1
  console.log('Selecting row 0 in GridView1 (User Face)...');
  await page.evaluate(() => {
    const chk = document.querySelector('[id*="ASPxGridView1_DXSelBtn0"]');
    if (chk) chk.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  // Select all devices in GridView2
  console.log('Selecting all devices in GridView2...');
  await page.evaluate(() => {
    const selAll = document.querySelector('#ContentPlaceHolder1_ASPxGridView2_DXSelAllBtn0') ||
                   document.querySelector('[id*="ASPxGridView2"][id*="DXSelAllBtn0"]');
    if (selAll) selAll.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  await page.screenshot({ path: 'scripts/template_selected.png' });

  // Click Upload button (ContentPlaceHolder1_ASPxButton1)
  console.log('Clicking Upload button in frmTemplateHTSeries...');
  await page.click('#ContentPlaceHolder1_ASPxButton1');
  await new Promise(r => setTimeout(r, 4000));

  await page.screenshot({ path: 'scripts/template_after_upload.png' });

  // Check top 5 commands in DeviceCommand.aspx!
  const cmdPage = await get('/DeviceCommand.aspx', cookieHeader);
  const rows = cmdPage.body.match(/<tr id="ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXDataRow\d+"[\s\S]*?<\/tr>/gi) || [];
  console.log('\nTop 5 commands in DeviceCommand.aspx after Template Upload:');
  rows.slice(0, 5).forEach((r, i) => {
    console.log(`  ${i}: ` + r.replace(/<[^>]+>/g, ' | ').replace(/\s+/g, ' ').trim());
  });

  await browser.close();
}

run().catch(console.error);
