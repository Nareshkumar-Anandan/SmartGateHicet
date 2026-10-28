const puppeteer = require('puppeteer-core');
const fs = require('fs');
const svc = require('../src/services/timewatchIdmsService');

function getEdgeExecutable() {
  return 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
}

async function runAndScreenshot() {
  const cookieHeader = await svc.login();
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

  const dialogs = [];
  page.on('dialog', async d => {
    console.log('[BROWSER DIALOG]:', d.message());
    dialogs.push(d.message());
    await d.accept();
  });

  console.log('1. Loading DownloadUser.aspx...');
  await page.goto('http://172.25.3.51:9001/DownloadUser.aspx', { waitUntil: 'networkidle0' });

  // Read Navaneeth's photo
  const photoBuf = fs.readFileSync('backend/uploads/students/720726106077.jpg');
  const dataUri = `data:image/jpeg;base64,${photoBuf.toString('base64')}`;

  console.log('2. Setting fields and uploading photo via WebMethod...');
  const res = await page.evaluate(async (uri) => {
    const dev = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_GrdDevice');
    if (dev) {
      dev.SetSelectedIndex(0);
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

    return new Promise(resolve => {
      PageMethods.uploasClientClick(uri, '8', 'IN1', 'Navaneeth M', 
        (r) => resolve({ ok: true, r }), 
        (e) => resolve({ ok: false, e: e.get_message() })
      );
    });
  }, dataUri);
  console.log('WebMethod result:', res);

  console.log('3. Selecting all turnstiles in grdDeviceU...');
  await page.evaluate(() => {
    const grid = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_grdDeviceU');
    if (grid) grid.SelectAllRowsOnPage();
  });
  await new Promise(r => setTimeout(r, 1000));

  await page.screenshot({ path: 'backend/scripts/screenshot_before_upload.png' });
  console.log('Saved screenshot_before_upload.png');

  console.log('4. Submitting btnUpload...');
  await page.evaluate(() => {
    const btn = document.getElementById('ContentPlaceHolder1_btnUpload_I');
    if (btn) btn.click();
    else {
      const c = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_btnUpload');
      if (c) c.DoClick();
    }
  });

  await new Promise(r => setTimeout(r, 6000));

  await page.screenshot({ path: 'backend/scripts/screenshot_after_upload.png' });
  console.log('Saved screenshot_after_upload.png');

  const status = await page.evaluate(() => {
    const el = document.getElementById('ContentPlaceHolder1_lblStatus');
    return el ? el.innerText : '';
  });
  console.log('Status label:', status);
  console.log('All dialogs caught:', dialogs);

  await browser.close();
}

runAndScreenshot().catch(console.error);
