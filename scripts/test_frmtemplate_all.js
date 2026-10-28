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

  await page.goto('http://172.25.3.51:9001/frmTemplateHTSeries.aspx', { waitUntil: 'networkidle0' });

  console.log('Selecting "All" radio button...');
  await page.evaluate(() => {
    const radios = Array.from(document.querySelectorAll('input[type="radio"], [id*="rbl"], [id*="RadioButton"]'));
    console.log('Radios:', radios.map(r => r.id + ' ' + r.value));
    const allRadio = document.querySelector('[id*="rbl_1"], [id*="All"], input[value="All"]');
    if (allRadio) allRadio.click();
    else {
      // Find label with "All"
      const labels = Array.from(document.querySelectorAll('label'));
      const allLbl = labels.find(l => l.innerText.trim() === 'All');
      if (allLbl) allLbl.click();
    }
  });

  await new Promise(r => setTimeout(r, 2000));

  const rows = await page.evaluate(() => {
    const r = Array.from(document.querySelectorAll('tr[id*="ASPxGridView1_DXDataRow"]'));
    return r.map(el => el.innerText.replace(/\s+/g, ' ').trim());
  });

  console.log(`Total rows with "All" radio: ${rows.length}`);
  rows.slice(0, 15).forEach((row, i) => console.log(`Row ${i}: ${row}`));

  await page.screenshot({ path: 'scripts/frmtemplate_all_radio.png' });
  await browser.close();
  process.exit(0);
})();
