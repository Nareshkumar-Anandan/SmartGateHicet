const puppeteer = require('puppeteer-core');
const svc = require('../src/services/timewatchIdmsService');

function getEdgeExecutable() {
  return 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
}

async function testOnlineEnrollHK() {
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
  await page.setCookie(...cookies);

  let dialogMsg = '';
  page.on('dialog', async d => {
    dialogMsg = d.message();
    console.log('[ALERT/DIALOG ON ENROLL]:', dialogMsg);
    await d.accept();
  });

  console.log('Opening OnlineEnrollment.aspx...');
  await page.goto('http://172.25.3.51:9001/OnlineEnrollment.aspx', { waitUntil: 'networkidle0' });

  for (const radName of ['ContentPlaceHolder1_radZK', 'ContentPlaceHolder1_radHK', 'ContentPlaceHolder1_radTF']) {
    console.log(`\nTesting radio ${radName}...`);
    await page.evaluate((name) => {
      const el = document.getElementById(name + '_S') || document.getElementById(name);
      if (el) el.click();
    }, radName);
    await new Promise(r => setTimeout(r, 2000));

    const info = await page.evaluate(() => {
      const dev = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_GrdDevice');
      if (!dev) return { found: false };
      const count = dev.GetItemCount();
      const items = [];
      for (let i = 0; i < count; i++) {
        items.push({ text: dev.GetItem(i).text, value: dev.GetItem(i).value });
      }
      return { count, items };
    });
    console.log(`Radio ${radName} devices:`, info);
  }

  await browser.close();
}

testOnlineEnrollHK().catch(console.error);
