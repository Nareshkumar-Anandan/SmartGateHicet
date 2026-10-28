const puppeteer = require('puppeteer-core');
const fs = require('fs');
const timewatchIdmsService = require('../src/services/timewatchIdmsService');

async function checkEditPopup() {
  await timewatchIdmsService._withBrowser(async (page) => {
    await page.goto('http://172.25.3.51:9001/Employee.aspx', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('#ContentPlaceHolder1_ASPxButton3', { timeout: 10000 });

    // Find the first row edit button
    const hasRow = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr[id*="DXDataRow"]'));
      if (rows.length === 0) return false;
      const editBtn = rows[0].querySelector('img[title="Edit"], a[title="Edit"], [id*="DXCBtn1"]');
      if (editBtn) {
        editBtn.click();
        return true;
      }
      return false;
    });

    console.log('Clicked edit button:', hasRow);
    await new Promise(r => setTimeout(r, 3000));

    // Get all text and tabs inside the edit popup
    const popupData = await page.evaluate(() => {
      const popup = document.querySelector('[id*="DXPEForm"]') || document.body;
      const inputs = Array.from(popup.querySelectorAll('input, select, textarea, div.dxbButton, a, img')).map(el => ({
        tag: el.tagName,
        id: el.id,
        name: el.name,
        type: el.type,
        title: el.title,
        src: el.src,
        text: el.innerText
      }));
      return {
        text: popup.innerText,
        inputs
      };
    });

    console.log('--- Popup Visible Text ---');
    console.log(popupData.text);

    console.log('--- Popup Elements with photo/image/file/upload ---');
    const photoEls = popupData.inputs.filter(x => 
      (x.id && /photo|image|pic|file|upload|bio/i.test(x.id)) ||
      (x.name && /photo|image|pic|file|upload|bio/i.test(x.name)) ||
      (x.title && /photo|image|pic|file|upload|bio/i.test(x.title)) ||
      (x.text && /photo|image|pic|file|upload|bio/i.test(x.text))
    );
    console.log(photoEls);

    // Take screenshot of edit form
    await page.screenshot({ path: 'employee-edit-form.png' });
    console.log('Screenshot saved to employee-edit-form.png');
  });
}

checkEditPopup().catch(console.error);
