const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const svc = require('../src/services/timewatchIdmsService');

function getEdgeExecutable() {
  return 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
}

async function uploadEmmanuvelPhoto() {
  console.log('Dispatching photo for Emmanuvel simson (PIN: 8)...');
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

  let dialogMsg = '';
  page.on('dialog', async d => {
    dialogMsg = d.message();
    console.log('[PHOTO UPLOAD DIALOG]:', dialogMsg);
    await d.accept();
  });

  await page.goto('http://172.25.3.51:9001/DownloadUser.aspx', { waitUntil: 'networkidle0' });

  const photoPath = path.resolve(__dirname, '../uploads/students/720826105011.jpg');
  const photoBuf = fs.readFileSync(photoPath);
  const dataUri = `data:image/jpeg;base64,${photoBuf.toString('base64')}`;

  console.log('Calling PageMethods.uploasClientClick...');
  const res = await page.evaluate(async (uri) => {
    const dev = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_GrdDevice');
    if (dev) dev.SetSelectedIndex(0);

    const user = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_txtuserID');
    if (user) {
      user.SetText('8');
      user.SetValue('8');
    }

    const nameCtrl = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_UserName');
    if (nameCtrl) {
      nameCtrl.SetText('Emmanuvel simson');
      nameCtrl.SetValue('Emmanuvel simson');
    }

    return new Promise(resolve => {
      PageMethods.uploasClientClick(uri, '8', 'IN1', 'Emmanuvel simson',
        (r) => resolve({ ok: true, r }),
        (e) => resolve({ ok: false, e: e.get_message() })
      );
    });
  }, dataUri);
  console.log('WebMethod result:', res);

  console.log('Selecting all devices in grdDeviceU and clicking btnUpload...');
  await page.evaluate(() => {
    const grid = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_grdDeviceU');
    if (grid) grid.SelectAllRowsOnPage();
  });
  await new Promise(r => setTimeout(r, 1000));

  await page.evaluate(() => {
    const btn = document.getElementById('ContentPlaceHolder1_btnUpload_I');
    if (btn) btn.click();
    else {
      const c = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_btnUpload');
      if (c) c.DoClick();
    }
  });

  await new Promise(r => setTimeout(r, 6000));
  console.log('Photo dispatch complete! Dialog:', dialogMsg);

  await browser.close();
}

uploadEmmanuvelPhoto().catch(console.error);
