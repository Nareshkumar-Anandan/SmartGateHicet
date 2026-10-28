const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const svc = require('../src/services/timewatchIdmsService');

(async () => {
  console.log('--- Step 1: Prepare and optimize Emmanuvel Simson photo to 352x432 JPEG ---');
  const rawPath = path.resolve(__dirname, '../uploads/students/720826105011.jpg');
  const rawBuf = fs.readFileSync(rawPath);
  console.log(`Original size: ${rawBuf.length} bytes`);

  // Resize to 352x432 matching DownloadUser.aspx webcam dimensions
  const optBuf = await sharp(rawBuf)
    .resize(352, 432, { fit: 'cover' })
    .jpeg({ quality: 95 })
    .toBuffer();
  console.log(`Optimized size (352x432): ${optBuf.length} bytes`);
  const dataUri = `data:image/jpeg;base64,${optBuf.toString('base64')}`;

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
    console.log('[BROWSER DIALOG]:', d.message());
    await d.accept().catch(() => {});
  });

  console.log('\n--- Step 2: Navigate to DownloadUser.aspx ---');
  await page.goto('http://172.25.3.51:9001/DownloadUser.aspx', { waitUntil: 'networkidle0' });

  console.log('Setting form inputs: User 8 (Emmanuvel simson)...');
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

  console.log('Invoking PageMethods.uploasClientClick with 352x432 photo...');
  const uploadRes = await page.evaluate(async (uri) => {
    window.data_uri_tmp = uri;
    return new Promise(resolve => {
      PageMethods.uploasClientClick(uri, '8', 'IN1', 'Emmanuvel simson',
        (res) => resolve({ ok: true, res }),
        (err) => resolve({ ok: false, err: err ? err.get_message() : 'fail' })
      );
    });
  }, dataUri);
  console.log('Upload client method result:', uploadRes);

  console.log('Selecting all devices in grdDeviceU...');
  await page.evaluate(() => {
    const grid = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_grdDeviceU');
    if (grid) grid.SelectAllRowsOnPage();
  });
  await new Promise(r => setTimeout(r, 1000));

  console.log('Clicking ContentPlaceHolder1_btnUpload (Upload)...');
  const navPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(e => console.log('Navigation event:', e.message));
  await page.evaluate(() => {
    const btn = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_btnUpload');
    if (btn) btn.DoClick();
    else document.getElementById('ContentPlaceHolder1_btnUpload_I').click();
  });
  await navPromise;
  await new Promise(r => setTimeout(r, 2000));

  console.log('\n--- Step 3: Navigate to frmTemplateHTSeries.aspx ---');
  await page.goto('http://172.25.3.51:9001/frmTemplateHTSeries.aspx', { waitUntil: 'networkidle0' });

  console.log('Selecting all devices on GridView2...');
  await page.evaluate(() => {
    const grid2 = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_ASPxGridView2');
    if (grid2) grid2.SelectAllRowsOnPage();
  });
  await new Promise(r => setTimeout(r, 1000));

  console.log('Selecting User 8 on GridView1...');
  await page.evaluate(() => {
    const grid1 = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_ASPxGridView1');
    if (grid1) grid1.SelectAllRowsOnPage();
  });
  await new Promise(r => setTimeout(r, 1000));

  console.log('Clicking Upload button on frmTemplateHTSeries (ASPxButton1)...');
  await page.evaluate(() => {
    const btn1 = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_ASPxButton1');
    if (btn1) btn1.DoClick();
    else document.getElementById('ContentPlaceHolder1_ASPxButton1_I').click();
  });
  await new Promise(r => setTimeout(r, 5000));

  console.log('\n--- Step 4: Verification ---');
  await page.goto('http://172.25.3.51:9001/UserList.aspx', { waitUntil: 'networkidle0' });
  const userListText = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tr[id*="DXDataRow"]'));
    return rows.map(r => r.innerText.replace(/\s+/g, ' ').trim());
  });
  console.log('UserList.aspx rows:');
  userListText.forEach(r => console.log('  ', r));

  await browser.close();
  console.log('\nDone!');
  process.exit(0);
})();
