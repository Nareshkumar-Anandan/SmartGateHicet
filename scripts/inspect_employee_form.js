const puppeteer = require('puppeteer-core');
const svc = require('../src/services/timewatchIdmsService');
const path = require('path');

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

  await page.goto('http://172.25.3.51:9001/Employee.aspx', { waitUntil: 'networkidle0' });

  // Open Edit for Row 0 (Emmanuvel)
  console.log('Clicking Edit on Row 0...');
  await page.evaluate(() => {
    const editBtn = document.querySelector('[id*="DXCBtn1"]');
    if (editBtn) editBtn.click();
  });

  await new Promise(r => setTimeout(r, 2000));

  // Find all editors / inputs in the popup form
  const formFields = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('[id*="DXPEForm"] input, [id*="DXPEForm"] img, [id*="DXPEForm"] label, [id*="DXPEForm"] td'));
    return inputs.map(el => ({
      tagName: el.tagName,
      id: el.id,
      name: el.getAttribute('name'),
      type: el.getAttribute('type'),
      src: el.getAttribute('src'),
      text: el.innerText
    })).filter(x => x.id || x.src || x.text);
  });

  console.log('Form fields found:', formFields.length);
  formFields.forEach(f => {
    const t = (f.text || '').toLowerCase();
    const id = (f.id || '').toLowerCase();
    if (t.includes('photo') || t.includes('image') || t.includes('pic') || id.includes('photo') || id.includes('img')) {
      console.log('MATCH:', f);
    }
  });

  await page.screenshot({ path: path.join(__dirname, 'employee_edit_popup.png') });
  console.log('Screenshot saved to scripts/employee_edit_popup.png');

  await browser.close();
  process.exit(0);
})();
