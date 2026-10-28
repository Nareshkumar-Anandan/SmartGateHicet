const puppeteer = require('puppeteer-core');
const svc = require('../src/services/timewatchIdmsService');
const { pool } = require('../src/config/database');

function getEdgeExecutable() {
  return 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
}

async function wipeAll() {
  console.log('=== STARTING COMPLETE HARDWARE AND SOFTWARE WIPE ===\n');

  // STEP 1: Wipe database logs, outings, and students in SmartGate
  console.log('1. Clearing SmartGate Database (gate_events, outings, students)...');
  const [eRes] = await pool.query('DELETE FROM gate_events');
  console.log(`   Deleted ${eRes.affectedRows} gate_events.`);
  const [oRes] = await pool.query('DELETE FROM outings');
  console.log(`   Deleted ${oRes.affectedRows} outings.`);
  const [sRes] = await pool.query('DELETE FROM students');
  console.log(`   Deleted ${sRes.affectedRows} students.`);
  await pool.query('UPDATE rooms SET current_occupancy = 0, status = "AVAILABLE"');
  console.log('   Reset all rooms occupancy to 0.');

  // STEP 2: Wipe Employees in TimeWatch iDMS (which queues "Delete User Data From Device" to all turnstiles)
  console.log('\n2. Deleting employees from TimeWatch iDMS Employee.aspx...');
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
    console.log('   [DIALOG CONFIRMATION]:', d.message());
    await d.accept();
  });

  await page.goto('http://172.25.3.51:9001/Employee.aspx', { waitUntil: 'networkidle0' });

  // Delete all employee rows in GridView1
  let deletedEmployees = 0;
  for (let i = 0; i < 10; i++) {
    const hasRow = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr[id*="ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXDataRow"]'));
      if (rows.length === 0) return false;
      const firstRow = rows[0];
      const delBtn = firstRow.querySelector('img[title="Delete"], img[alt="Delete"]');
      const link = delBtn ? (delBtn.closest('a') || delBtn) : firstRow.querySelector('a[title="Delete"]');
      if (link) {
        link.click();
        return true;
      }
      return false;
    });

    if (hasRow) {
      deletedEmployees++;
      await new Promise(r => setTimeout(r, 2500));
    } else {
      break;
    }
  }
  console.log(`   Successfully deleted ${deletedEmployees} employees from TimeWatch iDMS.`);

  // STEP 3: Clear Templates from Template Manage (frmTemplateHTSeries.aspx)
  console.log('\n3. Checking frmTemplateHTSeries.aspx for template cleanup...');
  await page.goto('http://172.25.3.51:9001/frmTemplateHTSeries.aspx', { waitUntil: 'networkidle0' });

  // Click Delete All (ASPxButton4)
  console.log('   Clicking "Delete All" button...');
  await page.evaluate(() => {
    const btn = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_ASPxButton4');
    if (btn) btn.DoClick();
  });
  await new Promise(r => setTimeout(r, 1500));

  // Enter password 'admin' in txtCheckPass and click OK (ASPxButton7)
  console.log('   Entering admin password in confirmation popup...');
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
  console.log('   Delete All command submitted!');

  await browser.close();

  // STEP 4: Verify Device Commands
  console.log('\n4. Verifying turnstile hardware commands in DeviceCommand.aspx...');
  const http = require('http');
  await new Promise(resolve => {
    http.get({ hostname: '172.25.3.51', port: 9001, path: '/DeviceCommand.aspx', headers: { Cookie: cookieHeader } }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        const rows = b.match(/<tr id="ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXDataRow\d+"[\s\S]*?<\/tr>/gi) || [];
        console.log(`   Top 5 latest commands:`);
        rows.slice(0, 5).forEach((r, i) => {
          console.log(`   ${i}: ` + r.replace(/<[^>]+>/g, ' | ').replace(/\s+/g, ' ').trim());
        });
        resolve();
      });
    });
  });

  console.log('\n=== COMPLETE HARDWARE & SOFTWARE WIPE FINISHED SUCCESSFULLY ===');
  process.exit(0);
}

wipeAll().catch(err => {
  console.error('Error during wipe:', err);
  process.exit(1);
});
