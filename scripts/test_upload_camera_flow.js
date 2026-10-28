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

  let dialogMsg = '';
  page.on('dialog', async d => {
    dialogMsg = d.message();
    console.log('[DIALOG]', dialogMsg);
    await d.accept();
  });

  await page.goto('http://172.25.3.51:9001/DownloadUser.aspx', { waitUntil: 'networkidle0' });

  const photoPath = path.resolve(__dirname, '../uploads/students/720826105011.jpg');
  const photoBuf = fs.readFileSync(photoPath);
  const dataUri = `data:image/jpeg;base64,${photoBuf.toString('base64')}`;

  console.log('1. Setting GrdDevice, txtuserID, UserName...');
  await page.evaluate(() => {
    const dev = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_GrdDevice');
    if (dev) {
      dev.SetSelectedIndex(0);
      document.getElementById('ContentPlaceHolder1_GrdDevice_I').value = dev.GetText();
    }
    const user = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_txtuserID');
    if (user) {
      user.SetText('8');
      user.SetValue('8');
      document.getElementById('ContentPlaceHolder1_txtuserID_I').value = '8';
    }
    const name = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_UserName');
    if (name) {
      name.SetText('Emmanuvel simson');
      name.SetValue('Emmanuvel simson');
      document.getElementById('ContentPlaceHolder1_UserName_I').value = 'Emmanuvel simson';
    }
  });

  console.log('2. Setting window.data_uri_tmp and clicking btnUploadCmaera...');
  await page.evaluate((uri) => {
    window.data_uri_tmp = uri;
    const img = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_UserPhoto');
    if (img && img.SetImageUrl) img.SetImageUrl(uri);
    
    // Call PageMethod directly or click button
    const btn = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_btnUploadCmaera');
    if (btn) btn.DoClick();
  }, dataUri);

  await new Promise(r => setTimeout(r, 4000));
  console.log('Dialog after Upload Camera Image:', dialogMsg);

  console.log('3. Clicking btnView to check if photo persists...');
  const nav = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(() => {});
  await page.evaluate(() => {
    const btn = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_btnView');
    if (btn) btn.DoClick();
  });
  await nav;
  await new Promise(r => setTimeout(r, 2000));

  const afterView = await page.evaluate(() => {
    const name = document.getElementById('ContentPlaceHolder1_UserName_I');
    const photo = document.getElementById('ContentPlaceHolder1_UserPhoto');
    const status = document.getElementById('ContentPlaceHolder1_lblStatus');
    return {
      name: name ? name.value : null,
      photoSrc: photo ? photo.src.slice(0, 100) : null,
      status: status ? status.innerText : null
    };
  });
  console.log('Result after btnView:', afterView);
  await page.screenshot({ path: 'scripts/downloaduser_test_camera_result.png' });

  await browser.close();
  process.exit(0);
})();
