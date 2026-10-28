const puppeteer = require('puppeteer-core');
const svc = require('../src/services/timewatchIdmsService');

function getEdgeExecutable() {
  return 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
}

async function testOnlineEnroll() {
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

  console.log('Selecting TrueFace radio (radTF)...');
  await page.evaluate(() => {
    const rad = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_radTF');
    if (rad) rad.SetChecked(true);
    else {
      const el = document.getElementById('ContentPlaceHolder1_radTF_S') || document.getElementById('ContentPlaceHolder1_radTF');
      if (el) el.click();
    }
  });
  await new Promise(r => setTimeout(r, 2000));

  const devInfo = await page.evaluate(() => {
    const dev = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_GrdDevice');
    if (!dev) return { found: false };
    const count = dev.GetItemCount();
    const items = [];
    for (let i = 0; i < count; i++) {
      items.push({ index: i, text: dev.GetItem(i).text, value: dev.GetItem(i).value });
    }
    return { found: true, count, items };
  });
  console.log('Device dropdown info after radTF:', devInfo);

  console.log('Selecting first device (index 0) and setting User 8 (Navaneeth M)...');
  await page.evaluate(() => {
    const dev = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_GrdDevice');
    if (dev && dev.GetItemCount() > 0) {
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
    const faceRad = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_radFace');
    if (faceRad) faceRad.SetChecked(true);
  });

  await new Promise(r => setTimeout(r, 1000));

  console.log('Clicking "Enroll" button...');
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

testOnlineEnroll().catch(console.error);
