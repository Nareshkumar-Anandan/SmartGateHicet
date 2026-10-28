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
    console.log('Dialog:', d.message());
    await d.accept();
  });

  await page.goto('http://172.25.3.51:9001/DownloadUser.aspx', { waitUntil: 'networkidle0' });

  // Enter User ID 8
  await page.evaluate(() => {
    const user = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_txtuserID');
    if (user) {
      user.SetText('8');
      user.SetValue('8');
    }
  });
  await new Promise(r => setTimeout(r, 1000));

  console.log('Clicking btnView (View)...');
  const nav = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(() => {});
  await page.evaluate(() => {
    const btn = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_btnView');
    if (btn) btn.DoClick();
  });
  await nav;
  await new Promise(r => setTimeout(r, 2000));

  const info = await page.evaluate(() => {
    const name = document.getElementById('ContentPlaceHolder1_UserName_I');
    const photo = document.getElementById('ContentPlaceHolder1_UserPhoto');
    const status = document.getElementById('ContentPlaceHolder1_lblStatus');
    return {
      name: name ? name.value : null,
      photoSrc: photo ? photo.src : null,
      status: status ? status.innerText : null
    };
  });
  console.log('Result after View:', info);
  await page.screenshot({ path: 'scripts/downloaduser_view_result.png' });

  await browser.close();
  process.exit(0);
})();
