const puppeteer = require('puppeteer-core');
const svc = require('../src/services/timewatchIdmsService');

function getEdgeExecutable() {
  return 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
}

async function testEnrollProper() {
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

  console.log('Setting Device, User 8, Face...');
  await page.evaluate(() => {
    const dev = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_GrdDevice');
    if (dev) {
      dev.SetSelectedIndex(0);
      const val = dev.GetValue();
      const txt = dev.GetText();
      const vi = document.getElementById('ContentPlaceHolder1_GrdDevice_VI');
      if (vi) vi.value = val;
      const inp = document.getElementById('ContentPlaceHolder1_GrdDevice_I');
      if (inp) inp.value = txt;
    }
    const user = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_txtuserID');
    if (user) {
      user.SetText('8');
      user.SetValue('8');
    }
    const userInp = document.getElementById('ContentPlaceHolder1_txtuserID_I');
    if (userInp) userInp.value = '8';

    const name = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_UserName');
    if (name) {
      name.SetText('Navaneeth M');
      name.SetValue('Navaneeth M');
    }
    const nameInp = document.getElementById('ContentPlaceHolder1_UserName_I');
    if (nameInp) nameInp.value = 'Navaneeth M';

    const face = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_radFace');
    if (face) face.SetChecked(true);
    const faceEl = document.getElementById('ContentPlaceHolder1_radFace_S');
    if (faceEl) faceEl.value = 'C';
  });

  await new Promise(r => setTimeout(r, 1000));

  console.log('Clicking Enroll button...');
  await page.evaluate(() => {
    const btn = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_btnUploadOffline');
    if (btn) btn.DoClick();
  });

  await new Promise(r => setTimeout(r, 4000));

  const statusText = await page.evaluate(() => {
    const el = document.getElementById('ContentPlaceHolder1_lblStatus');
    return el ? el.innerText : '';
  });
  console.log('Status label:', statusText);
  console.log('Dialog caught:', dialogMsg);

  await browser.close();
}

testEnrollProper().catch(console.error);
