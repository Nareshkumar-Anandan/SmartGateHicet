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

  let dialogMsg = '';
  page.on('dialog', async d => {
    dialogMsg = d.message();
    console.log('[DIALOG ON frmTemplateHTSeries]:', dialogMsg);
    await d.accept().catch(() => {});
  });

  await page.goto('http://172.25.3.51:9001/frmTemplateHTSeries.aspx', { waitUntil: 'networkidle0' });

  // 1. Select device(s) on ASPxGridView2
  console.log('Selecting devices on GridView2...');
  await page.evaluate(() => {
    const grid2 = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_ASPxGridView2');
    if (grid2) grid2.SelectAllRowsOnPage();
  });
  await new Promise(r => setTimeout(r, 1000));

  // 2. Select User 8 on ASPxGridView1
  console.log('Selecting user 8 on GridView1...');
  await page.evaluate(() => {
    const grid1 = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_ASPxGridView1');
    if (grid1) grid1.SelectAllRowsOnPage();
  });
  await new Promise(r => setTimeout(r, 1000));

  // 3. Click Upload (ASPxButton1)
  console.log('Clicking Upload button...');
  await page.evaluate(() => {
    const btn1 = document.getElementById('ContentPlaceHolder1_ASPxButton1');
    if (btn1) btn1.click();
    else {
      const c = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_ASPxButton1');
      if (c) c.DoClick();
    }
  });

  await new Promise(r => setTimeout(r, 6000));
  console.log('Upload clicked! Dialog was:', dialogMsg);

  await browser.close();
  process.exit(0);
})();
