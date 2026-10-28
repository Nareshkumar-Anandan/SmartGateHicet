const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const svc = require('../src/services/timewatchIdmsService');

(async () => {
  console.log('Testing batch photo upload in single browser session...');
  const cookieHeader = await svc.login();
  const cookies = cookieHeader.split(';').map(c => {
    const [name, ...rest] = c.trim().split('=');
    return { name, value: rest.join('='), domain: '172.25.3.51', path: '/' };
  }).filter(c => c.name && c.value);

  const browser = await puppeteer.launch({
    executablePath: svc._getEdgeExecutable(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setCookie(...cookies);
  let dialogMsg = '';
  page.on('dialog', async d => {
    dialogMsg = d.message();
    console.log('[DIALOG]', dialogMsg);
    await d.accept();
  });

  await page.goto('http://172.25.3.51:9001/DownloadUser.aspx', { waitUntil: 'networkidle0' });

  const buf8 = fs.readFileSync(path.resolve(__dirname, '../uploads/students/720826105011.jpg'));
  const buf9 = fs.readFileSync(path.resolve(__dirname, '../uploads/students/720726106077.jpg'));

  const users = [
    { pin: '8', name: 'Emmanuvel simson', uri: `data:image/jpeg;base64,${buf8.toString('base64')}` },
    { pin: '9', name: 'Navaneeth M', uri: `data:image/jpeg;base64,${buf9.toString('base64')}` }
  ];

  for (const u of users) {
    const res = await page.evaluate(async (uri, pin, name) => {
      const dev = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_GrdDevice');
      if (dev) dev.SetSelectedIndex(0);

      const user = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_txtuserID');
      if (user) { user.SetText(pin); user.SetValue(pin); }

      const nameCtrl = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_UserName');
      if (nameCtrl) { nameCtrl.SetText(name); nameCtrl.SetValue(name); }

      return new Promise(resolve => {
        PageMethods.uploasClientClick(uri, pin, 'IN1', name,
          () => resolve(true),
          () => resolve(false)
        );
      });
    }, u.uri, u.pin, u.name);
    console.log(`Uploaded photo for ${u.name} (PIN: ${u.pin}) => ${res}`);
  }

  // Now select all devices and upload once
  console.log('Selecting all devices in grdDeviceU and clicking btnUpload...');
  await page.evaluate(() => {
    const grid = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_grdDeviceU');
    if (grid) grid.SelectAllRowsOnPage();
    const btn = document.getElementById('ContentPlaceHolder1_btnUpload_I');
    if (btn) btn.click();
    else {
      const c = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_btnUpload');
      if (c) c.DoClick();
    }
  });

  await new Promise(r => setTimeout(r, 5000));
  console.log('Batch dispatch completed! Last dialog:', dialogMsg);

  await browser.close();
  process.exit(0);
})();
