const puppeteer = require('puppeteer-core');
const fs = require('fs');
const timewatchIdmsService = require('../src/services/timewatchIdmsService');

async function checkUserPhoto() {
  await timewatchIdmsService._withBrowser(async (page) => {
    await page.goto('http://172.25.3.51:9001/UserPhoto.aspx', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));

    const photos = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr[id*="DXDataRow"]'));
      return rows.map(r => {
        const cells = Array.from(r.querySelectorAll('td')).map(c => c.innerText.trim());
        const img = r.querySelector('img');
        return {
          device: cells[0],
          uid: cells[1],
          name: cells[2],
          imgSrc: img ? img.src : null
        };
      });
    });

    console.log('Photos on UserPhoto.aspx:', JSON.stringify(photos, null, 2));

    if (photos.length > 0 && photos[0].imgSrc) {
      const viewSource = await page.goto(photos[0].imgSrc);
      const buf = await viewSource.buffer();
      fs.writeFileSync('scripts/live_face_sample.jpg', buf);
      console.log('Downloaded sample face photo from iDMS! Size:', buf.length);
    }
  });
}

checkUserPhoto().catch(console.error);
