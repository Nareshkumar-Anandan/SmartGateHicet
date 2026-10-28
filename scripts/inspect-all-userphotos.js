const puppeteer = require('puppeteer-core');
const svc = require('../src/services/timewatchIdmsService');

function getEdgeExecutable() {
  return 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
}

async function inspectUserPhotoPages() {
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

  console.log('Opening UserPhoto.aspx...');
  await page.goto('http://172.25.3.51:9001/UserPhoto.aspx', { waitUntil: 'networkidle0' });

  // Get summary / pager
  const pagerText = await page.evaluate(() => {
    const p = document.querySelector('.dxp-summary') || document.querySelector('.dxp-lead');
    return p ? p.innerText : 'no pager found';
  });
  console.log('Pager:', pagerText);

  // Fetch all rows on current page
  const rows = await page.evaluate(() => {
    const tableRows = Array.from(document.querySelectorAll('tr[id*="ContentPlaceHolder1_ASPxGridView1_DXDataRow"]'));
    return tableRows.map(r => {
      const cells = Array.from(r.querySelectorAll('td')).map(c => c.innerText.trim());
      const img = r.querySelector('img');
      return {
        device: cells[0],
        uid: cells[1],
        name: cells[2],
        hasImg: !!img,
        imgSrc: img ? img.src : null
      };
    });
  });

  console.log(`Total rows on page 1 of UserPhoto.aspx: ${rows.length}`);
  rows.forEach(r => {
    console.log(`  Device: ${r.device} | UID: ${r.uid} | Name: ${r.name} | HasImg: ${r.hasImg} | Src: ${r.imgSrc}`);
  });

  const has8 = rows.find(r => r.uid === '8');
  const has9 = rows.find(r => r.uid === '9');
  console.log('\nUser 8 on UserPhoto.aspx:', has8 || 'NOT FOUND');
  console.log('User 9 on UserPhoto.aspx:', has9 || 'NOT FOUND');

  await browser.close();
}

inspectUserPhotoPages().catch(console.error);
