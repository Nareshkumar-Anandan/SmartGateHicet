const puppeteer = require('puppeteer-core');
const svc = require('../src/services/timewatchIdmsService');

function getEdgeExecutable() {
  return 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
}

async function wipeTemplates() {
  console.log('Wiping templates from turnstiles via frmTemplateHTSeries.aspx...');
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
  await page.setViewport({ width: 1280, height: 900 });
  await page.setCookie(...cookies);

  page.on('dialog', async d => {
    console.log('   [DIALOG]:', d.message());
    await d.accept();
  });

  await page.goto('http://172.25.3.51:9001/frmTemplateHTSeries.aspx', { waitUntil: 'networkidle0' });

  // 1. Select all users in GridView1
  console.log('1. Selecting all users in GridView1...');
  await page.evaluate(() => {
    const grid1 = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_ASPxGridView1');
    if (grid1) grid1.SelectAllRowsOnPage();
  });
  await new Promise(r => setTimeout(r, 1000));

  // 2. Select all devices in GridView2
  console.log('2. Selecting all devices in GridView2...');
  await page.evaluate(() => {
    const grid2 = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_ASPxGridView2');
    if (grid2) grid2.SelectAllRowsOnPage();
  });
  await new Promise(r => setTimeout(r, 1000));

  // 3. Click Delete All (ASPxButton4)
  console.log('3. Clicking "Delete All" button...');
  await page.evaluate(() => {
    const btn = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_ASPxButton4');
    if (btn) btn.DoClick();
  });
  await new Promise(r => setTimeout(r, 1500));

  // 4. Enter password 'admin' in txtCheckPass and click OK (ASPxButton7)
  console.log('4. Entering admin password in confirmation popup...');
  await page.evaluate(() => {
    const pass = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_passCheck_ASPxPanel1_ASPxFormLayout1_txtCheckPass');
    if (pass) {
      pass.SetText('admin');
      pass.SetValue('admin');
    }
    const inp = document.getElementById('ContentPlaceHolder1_passCheck_ASPxPanel1_ASPxFormLayout1_txtCheckPass_I');
    if (inp) inp.value = 'admin';

    const okBtn = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_passCheck_ASPxPanel1_ASPxFormLayout1_ASPxButton7');
    if (okBtn) okBtn.DoClick();
    else {
      const el = document.getElementById('ContentPlaceHolder1_passCheck_ASPxPanel1_ASPxFormLayout1_ASPxButton7_I');
      if (el) el.click();
    }
  });

  await new Promise(r => setTimeout(r, 4000));
  console.log('5. Delete All executed!');

  await browser.close();
}

wipeTemplates().catch(console.error);
