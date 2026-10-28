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

  console.log('Navigating to frmTemplateHTSeries.aspx...');
  await page.goto('http://172.25.3.51:9001/frmTemplateHTSeries.aspx', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ContentPlaceHolder1_ASPxButton3', { timeout: 10000 });

  // Select row 0 (shyam, OUT1, Face)
  console.log('Selecting Row 0 (shyam, Face)...');
  await page.evaluate(() => {
    const chk = document.querySelector('[id*="ASPxGridView1_DXSelBtn0"]');
    if (chk) chk.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  // Click View Image
  console.log('Clicking View Image...');
  await page.click('#ContentPlaceHolder1_ASPxButton3');
  await new Promise(r => setTimeout(r, 3000));

  await page.screenshot({ path: 'scripts/view_image_row0.png' });
  console.log('Screenshot saved to scripts/view_image_row0.png');

  // Check if any popup or image appeared
  const popups = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img')).map(i => ({ id: i.id, src: i.src, visible: i.offsetParent !== null }));
    return imgs.filter(i => i.src && !i.src.includes('logo') && !i.src.includes('DXR'));
  });
  console.log('Images displayed on page:', popups);

  await browser.close();
  process.exit(0);
})();
