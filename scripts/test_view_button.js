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

  // Type user ID 8
  await page.evaluate(() => {
    const dev = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_GrdDevice');
    if (dev) dev.SetSelectedIndex(0);

    const user = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_txtuserID');
    if (user) {
      user.SetText('8');
      user.SetValue('8');
    }
  });

  // Click View button
  console.log('Clicking View button...');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(() => {}),
    page.evaluate(() => {
      const btn = document.getElementById('ContentPlaceHolder1_btnView_I');
      if (btn) btn.click();
    })
  ]);

  const photoSrc = await page.evaluate(() => {
    const img = document.getElementById('ContentPlaceHolder1_UserPhoto');
    const name = document.getElementById('ContentPlaceHolder1_UserName_I');
    return {
      src: img ? img.src : null,
      name: name ? name.value : null
    };
  });

  console.log('After View clicked:', photoSrc);

  await browser.close();
  process.exit(0);
})();
