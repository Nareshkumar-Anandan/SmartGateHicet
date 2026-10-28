const puppeteer = require('puppeteer-core');
const fs = require('fs');
const svc = require('../src/services/timewatchIdmsService');

function getEdgeExecutable() {
  return 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
}

async function uploadStudent(pin, name, photoPath) {
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
    console.log(`[USER ${pin} DIALOG]:`, dialogMsg);
    await d.accept();
  });

  console.log(`1. Loading DownloadUser.aspx for User ${pin} (${name})...`);
  await page.goto('http://172.25.3.51:9001/DownloadUser.aspx', { waitUntil: 'networkidle0' });

  const photoBuf = fs.readFileSync(photoPath);
  const dataUri = `data:image/jpeg;base64,${photoBuf.toString('base64')}`;

  console.log('2. Setting fields and uploading photo via WebMethod...');
  const res = await page.evaluate(async (uri, p, n) => {
    const dev = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_GrdDevice');
    if (dev) {
      dev.SetSelectedIndex(0);
    }
    const user = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_txtuserID');
    if (user) {
      user.SetText(p);
      user.SetValue(p);
    }
    const nameCtrl = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_UserName');
    if (nameCtrl) {
      nameCtrl.SetText(n);
      nameCtrl.SetValue(n);
    }

    return new Promise(resolve => {
      PageMethods.uploasClientClick(uri, p, 'IN1', n, 
        (r) => resolve({ ok: true, r }), 
        (e) => resolve({ ok: false, e: e.get_message() })
      );
    });
  }, dataUri, String(pin), name);
  console.log('WebMethod result:', res);

  console.log('3. Selecting all turnstiles in grdDeviceU...');
  await page.evaluate(() => {
    const grid = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_grdDeviceU');
    if (grid) grid.SelectAllRowsOnPage();
  });
  await new Promise(r => setTimeout(r, 1000));

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
  console.log(`User ${pin} upload complete! Dialog:`, dialogMsg);

  await browser.close();
}

(async () => {
  console.log('Uploading User 9 (RUTHRAN C)...');
  await uploadStudent('9', 'RUTHRAN C', 'backend/uploads/students/720726109081.jpg');
  console.log('All student photos uploaded and dispatched to turnstiles!');
})();
