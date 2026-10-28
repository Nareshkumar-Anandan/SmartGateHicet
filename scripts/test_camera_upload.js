const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const svc = require('../src/services/timewatchIdmsService');

(async () => {
  const cookieHeader = await svc.login();
  const cookies = cookieHeader.split(';').map(c => {
    const [name, ...rest] = c.trim().split('=');
    return { name, value: rest.join('='), domain: '172.25.3.51', path: '/' };
  }).filter(c => c.name && c.value);

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setCookie(...cookies);

  page.on('dialog', async d => {
    console.log('[DIALOG ON DownloadUser]:', d.message());
    await d.accept().catch(() => {});
  });

  page.on('console', msg => console.log('[BROWSER CONSOLE]', msg.text()));

  await page.goto('http://172.25.3.51:9001/DownloadUser.aspx', { waitUntil: 'networkidle0' });

  const photoPath = path.resolve(__dirname, '../uploads/students/720826105011.jpg');
  const photoBuf = fs.readFileSync(photoPath);
  const dataUri = `data:image/jpeg;base64,${photoBuf.toString('base64')}`;

  console.log('Setting form values and data_uri_tmp on DownloadUser.aspx...');
  await page.evaluate((uri) => {
    window.data_uri_tmp = uri;

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

    const photoImg = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_UserPhoto');
    if (photoImg) {
      photoImg.SetImageUrl(uri);
    }
  }, dataUri);

  console.log('Clicking btnUploadCmaera...');
  await page.evaluate(() => {
    const btn = document.getElementById('ContentPlaceHolder1_btnUploadCmaera_I');
    if (btn) btn.click();
    else {
      const c = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_btnUploadCmaera');
      if (c) c.DoClick();
    }
  });

  await new Promise(r => setTimeout(r, 6000));
  console.log('btnUploadCmaera click completed');

  await browser.close();
  process.exit(0);
})();
