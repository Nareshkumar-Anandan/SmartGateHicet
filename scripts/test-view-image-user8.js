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

  await page.goto('http://172.25.3.51:9001/frmTemplateHTSeries.aspx', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ContentPlaceHolder1_ASPxButton3', { timeout: 10000 });

  // Find the exact row index for User 8 (IN2 or IN1)
  const rowIndex = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tr[id*="ASPxGridView1_DXDataRow"]'));
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].innerText.includes('Emmanuvel simson') && rows[i].innerText.includes('IN1')) {
        return i;
      }
    }
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].innerText.includes('Emmanuvel simson')) {
        return i;
      }
    }
    return -1;
  });
  console.log('User 8 row index:', rowIndex);

  if (rowIndex !== -1) {
    await page.evaluate((idx) => {
      const chk = document.querySelector(`[id*="ASPxGridView1_DXSelBtn${idx}"]`);
      if (chk) chk.click();
    }, rowIndex);
    await new Promise(r => setTimeout(r, 1000));

    console.log('Clicking View Image for User 8...');
    await page.click('#ContentPlaceHolder1_ASPxButton3');
    await new Promise(r => setTimeout(r, 3000));

    const pageContent = await page.evaluate(() => document.body.innerText);
    console.log('Text after View Image for User 8:\n', pageContent.slice(0, 500));

    await page.screenshot({ path: 'scripts/view_image_user8.png' });
    console.log('Screenshot saved to scripts/view_image_user8.png');
  }

  await browser.close();
  process.exit(0);
})();
