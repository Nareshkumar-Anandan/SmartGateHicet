const svc = require('../src/services/timewatchIdmsService');

async function addEmmanuvel() {
  console.log('Adding Emmanuvel simson (PIN: 8) to Employee.aspx...');
  await svc._withBrowser(async (page) => {
    await page.goto(`${svc.serverUrl}/Employee.aspx`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('#ContentPlaceHolder1_ASPxButton3', { timeout: 10000 });

    const userPin = '8';
    const userName = 'Emmanuvel simson';

    console.log('Clicking New (+) button...');
    await page.evaluate(() => {
      const addBtn = document.querySelector('[id*="DXCBtn0"]') || document.querySelector('img[title="New"]');
      if (addBtn) addBtn.click();
    });

    await page.waitForSelector('#ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXPEForm_DXEFL_DXEditor2_I', { visible: true, timeout: 8000 });

    console.log('Filling Emp Code & Enroll ID...');
    await page.click('#ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXPEForm_DXEFL_DXEditor2_I');
    await page.type('#ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXPEForm_DXEFL_DXEditor2_I', userPin);

    await page.click('#ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXPEForm_DXEFL_DXEditor3_I');
    await page.type('#ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXPEForm_DXEFL_DXEditor3_I', userPin);

    await page.click('#ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXPEForm_DXEFL_DXEditor4_I');
    await page.type('#ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXPEForm_DXEFL_DXEditor4_I', userName);

    console.log('Selecting Company...');
    await page.click('#ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXPEForm_DXEFL_DXEditor9_I');
    await page.type('#ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXPEForm_DXEFL_DXEditor9_I', 'TimeWatch');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 400));

    console.log('Selecting Department...');
    await page.click('#ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXPEForm_DXEFL_DXEditor10_I');
    await page.type('#ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXPEForm_DXEFL_DXEditor10_I', 'ADMIN');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 400));

    console.log('Saving employee...');
    await page.evaluate(() => {
      const saveBtn = document.getElementById('ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXPEForm_DXEFL_DXCBtn19') ||
                      document.querySelector('img[title="Save"]');
      if (saveBtn) saveBtn.click();
    });

    await new Promise(r => setTimeout(r, 3000));

    console.log('Selecting employee row and clicking Upload To Device...');
    await page.evaluate(() => {
      const chk = document.querySelector('#ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXSelAllBtn0') ||
                  document.querySelector('[id*="DXSelAllBtn0"]');
      if (chk) chk.click();
    });
    await new Promise(r => setTimeout(r, 800));

    await page.evaluate(() => {
      const btn = document.getElementById('ContentPlaceHolder1_ASPxButton3') ||
                  document.getElementById('ContentPlaceHolder1_ASPxButton3_CD');
      if (btn) btn.click();
    });

    await new Promise(r => setTimeout(r, 1500));
    console.log('Selecting all devices in popup and confirming...');
    await page.evaluate(() => {
      const devChk = document.querySelector('#ContentPlaceHolder1_pcLogin_Panel1_ASPxFormLayout2_grdDevice_DXSelAllBtn0') ||
                     document.querySelector('[id*="grdDevice"][id*="DXSelAllBtn0"]');
      if (devChk) devChk.click();

      const okBtn = document.getElementById('ContentPlaceHolder1_pcLogin_Panel1_ASPxFormLayout2_btOK') ||
                    document.getElementById('ContentPlaceHolder1_pcLogin_Panel1_ASPxFormLayout2_btOK_CD') ||
                    document.querySelector('[id*="btOK"]');
      if (okBtn) okBtn.click();
    });

    await new Promise(r => setTimeout(r, 4000));
    console.log('Employee push to devices complete!');
  });
}

addEmmanuvel().catch(console.error);
