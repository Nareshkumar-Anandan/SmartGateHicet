const puppeteer = require('puppeteer-core');
const svc = require('../src/services/timewatchIdmsService');

function getEdgeExecutable() {
  return 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
}

async function checkAllPages() {
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

  await page.goto('http://172.25.3.51:9001/frmTemplateHTSeries.aspx', { waitUntil: 'networkidle0' });

  // Get all users across pages in GridView1
  const allUsers = [];
  
  for (let p = 1; p <= 3; p++) {
    const usersOnPage = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr[id*="ContentPlaceHolder1_ASPxGridView1_DXDataRow"]'));
      return rows.map(r => {
        const cells = Array.from(r.querySelectorAll('td')).map(c => c.innerText.trim());
        return { uid: cells[1], name: cells[2], dev: cells[3], type: cells[4] };
      });
    });
    console.log(`Page ${p} has ${usersOnPage.length} items`);
    allUsers.push(...usersOnPage);

    if (p < 3) {
      await page.evaluate(() => {
        const grid = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_ASPxGridView1');
        if (grid) grid.NextPage();
      });
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log('All unique users in template manager:');
  const uniqueUids = [...new Set(allUsers.map(u => `${u.uid} - ${u.name} (${u.type})`))];
  uniqueUids.forEach(u => console.log('  ', u));

  console.log('Is User 8 present?', allUsers.some(u => u.uid === '8'));
  console.log('Is User 9 present?', allUsers.some(u => u.uid === '9'));

  await browser.close();
}

checkAllPages().catch(console.error);
