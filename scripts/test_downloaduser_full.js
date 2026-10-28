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
    console.log('[DIALOG]', d.message());
    await d.accept();
  });

  page.on('console', msg => console.log('[BROWSER CONSOLE]', msg.text()));

  await page.goto('http://172.25.3.51:9001/DownloadUser.aspx', { waitUntil: 'networkidle0' });

  const photoBuf = fs.readFileSync(path.resolve(__dirname, '../uploads/students/720826105011.jpg'));
  const dataUri = `data:image/jpeg;base64,${photoBuf.toString('base64')}`;

  console.log('1. Setting GrdDevice, txtuserID, UserName...');
  await page.evaluate(() => {
    const dev = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_GrdDevice');
    if (dev) {
      dev.SetSelectedIndex(0);
      console.log('Device selected:', dev.GetText(), dev.GetValue());
    }
    const user = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_txtuserID');
    if (user) {
      user.SetText('8');
      user.SetValue('8');
    }
    const name = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_UserName');
    if (name) {
      name.SetText('Emmanuvel simson');
      name.SetValue('Emmanuvel simson');
    }
  });

  console.log('2. Invoking PageMethods.uploasClientClick...');
  const uploadRes = await page.evaluate(async (uri) => {
    return new Promise(resolve => {
      PageMethods.uploasClientClick(uri, '8', 'IN1', 'Emmanuvel simson',
        (res) => resolve({ success: true, res }),
        (err) => resolve({ success: false, err: err ? err.get_message() : 'unknown' })
      );
    });
  }, dataUri);
  console.log('Upload WebMethod response:', uploadRes);

  console.log('3. Selecting all devices in grdDeviceU...');
  const selectedCount = await page.evaluate(() => {
    const grid = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_grdDeviceU');
    if (grid) {
      grid.SelectAllRowsOnPage();
      return grid.GetSelectedRowCount();
    }
    return 0;
  });
  console.log('Selected devices count:', selectedCount);

  await new Promise(r => setTimeout(r, 1000));

  console.log('4. Clicking ContentPlaceHolder1_btnUpload...');
  const navPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(e => console.log('Navigation timeout or no nav:', e.message));
  
  await page.evaluate(() => {
    const btn = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_btnUpload');
    if (btn) btn.DoClick();
    else document.getElementById('ContentPlaceHolder1_btnUpload_I').click();
  });

  await navPromise;
  await new Promise(r => setTimeout(r, 2000));

  const statusText = await page.evaluate(() => {
    const s = document.getElementById('ContentPlaceHolder1_lblStatus');
    return s ? s.innerText : 'none';
  });
  console.log('Status after btnUpload:', statusText);

  await page.screenshot({ path: 'scripts/status_after_btnupload.png' });
  console.log('Screenshot saved to scripts/status_after_btnupload.png');

  await browser.close();
  process.exit(0);
})();
