const puppeteer = require('puppeteer-core');
const svc = require('../src/services/timewatchIdmsService');

function getEdgeExecutable() {
  return 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
}

async function testDownloadUpload() {
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

  page.on('dialog', async d => {
    console.log('[DIALOG]', d.message());
    await d.accept();
  });

  console.log('Opening DownloadUser.aspx...');
  await page.goto('http://172.25.3.51:9001/DownloadUser.aspx', { waitUntil: 'networkidle0' });

  console.log('Setting Source Device = IN1, User ID = 3 (NARESH)...');
  await page.evaluate(() => {
    const dev = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_GrdDevice');
    if (dev) {
      dev.SetText('IN1');
      dev.SetValue('IN1');
    }
    const user = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_txtuserID');
    if (user) {
      user.SetText('3');
      user.SetValue('3');
    }
  });

  console.log('Clicking "Download" button to fetch Naresh face template from IN1...');
  const navPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(e => console.log('Download nav completed/timeout'));
  await page.evaluate(() => {
    const btn = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_btnUploadOffline0');
    if (btn) btn.DoClick();
  });
  await navPromise;
  await new Promise(r => setTimeout(r, 3000));

  const afterDownload = await page.evaluate(() => {
    const name = document.getElementById('ContentPlaceHolder1_UserName_I');
    const photo = document.getElementById('ContentPlaceHolder1_UserPhoto');
    const status = document.getElementById('ContentPlaceHolder1_lblStatus');
    return {
      name: name ? name.value : null,
      photoSrc: photo ? photo.src : null,
      status: status ? status.innerText : null
    };
  });
  console.log('After Download click:', afterDownload);

  await browser.close();
}

testDownloadUpload().catch(console.error);
