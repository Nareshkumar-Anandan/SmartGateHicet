const puppeteer = require('puppeteer-core');
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
    console.log('[DIALOG]', d.message());
    await d.accept();
  });

  console.log('Navigating to DownloadUser.aspx...');
  await page.goto('http://172.25.3.51:9001/DownloadUser.aspx', { waitUntil: 'networkidle0' });

  // 1. Set Source Device = OUT1 (where User 1 has face)
  console.log('Setting Source Device = OUT1, User ID = 1...');
  await page.evaluate(() => {
    const dev = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_GrdDevice');
    if (dev) {
      dev.SetText('OUT1');
      dev.SetValue('OUT1');
    }
    const user = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_txtuserID');
    if (user) {
      user.SetText('1');
      user.SetValue('1');
    }
  });

  // 2. Click Download
  console.log('Clicking Download...');
  const navPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {});
  await page.evaluate(() => {
    const btn = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_btnUploadOffline0');
    if (btn) btn.DoClick();
  });
  await navPromise;
  await new Promise(r => setTimeout(r, 2000));

  const downloadedData = await page.evaluate(() => {
    const name = document.getElementById('ContentPlaceHolder1_UserName_I');
    const photo = document.getElementById('ContentPlaceHolder1_UserPhoto');
    const status = document.getElementById('ContentPlaceHolder1_lblStatus');
    return {
      name: name ? name.value : null,
      photoSrc: photo ? photo.src.slice(0, 50) : null,
      status: status ? status.innerText : null
    };
  });
  console.log('Downloaded data from OUT1 for User 1:', downloadedData);

  // 3. Set New User ID = 8
  console.log('Setting New User ID = 8...');
  await page.evaluate(() => {
    const newUser = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_txtNewUser');
    if (newUser) {
      newUser.SetText('8');
      newUser.SetValue('8');
    }
  });
  await new Promise(r => setTimeout(r, 1000));

  // 4. Select all devices in grdDeviceU
  console.log('Selecting all devices in grdDeviceU...');
  await page.evaluate(() => {
    const grid = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_grdDeviceU');
    if (grid) grid.SelectAllRowsOnPage();
  });
  await new Promise(r => setTimeout(r, 1000));

  // 5. Click Upload
  console.log('Clicking Upload to push to User 8...');
  const uploadNav = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {});
  await page.evaluate(() => {
    const btn = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_btnUpload');
    if (btn) btn.DoClick();
  });
  await uploadNav;
  await new Promise(r => setTimeout(r, 3000));

  const afterUploadStatus = await page.evaluate(() => {
    const status = document.getElementById('ContentPlaceHolder1_lblStatus');
    return status ? status.innerText : 'none';
  });
  console.log('After Upload Status:', afterUploadStatus);

  await page.screenshot({ path: 'scripts/after_transfer_user8.png' });
  await browser.close();
  process.exit(0);
})();
