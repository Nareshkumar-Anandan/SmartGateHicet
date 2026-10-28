const puppeteer = require('puppeteer-core');
const svc = require('../src/services/timewatchIdmsService');

function getEdgeExecutable() {
  return 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
}

async function testEnrollFull() {
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
    console.log('\n======================================');
    console.log('[DEVICE ALERT DIALOG]:', dialogMsg);
    console.log('======================================\n');
    await d.accept();
  });

  console.log('1. Navigating to OnlineEnrollment.aspx...');
  await page.goto('http://172.25.3.51:9001/OnlineEnrollment.aspx', { waitUntil: 'networkidle0' });

  console.log('2. Clicking radTF and waiting for navigation/postback...');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.evaluate(() => {
      const el = document.getElementById('ContentPlaceHolder1_radTF_S') || document.getElementById('ContentPlaceHolder1_radTF');
      if (el) el.click();
    })
  ]);

  console.log('3. Postback finished! Setting Device, User 8, Face...');
  const devCount = await page.evaluate(() => {
    const dev = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_GrdDevice');
    return dev ? dev.GetItemCount() : 0;
  });
  console.log('Available turnstiles in dropdown:', devCount);

  await page.evaluate(() => {
    const dev = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_GrdDevice');
    if (dev) {
      dev.SetSelectedIndex(0);
    }
    const user = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_txtuserID');
    if (user) {
      user.SetText('8');
      user.SetValue('8');
    }
    const name = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_UserName');
    if (name) {
      name.SetText('Navaneeth M');
      name.SetValue('Navaneeth M');
    }
    const face = document.getElementById('ContentPlaceHolder1_radFace_S') || document.getElementById('ContentPlaceHolder1_radFace');
    if (face) face.click();
  });

  await new Promise(r => setTimeout(r, 1000));

  console.log('4. Clicking "Enroll" button...');
  await page.evaluate(() => {
    const btn = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_btnUploadOffline');
    if (btn) btn.DoClick();
  });

  await new Promise(r => setTimeout(r, 5000));

  const statusText = await page.evaluate(() => {
    const el = document.getElementById('ContentPlaceHolder1_lblStatus');
    return el ? el.innerText : '';
  });
  console.log('Status label:', statusText);
  console.log('Dialog caught:', dialogMsg);

  await browser.close();
}

testEnrollFull().catch(console.error);
