const svc = require('../src/services/timewatchIdmsService');

async function listEmployees() {
  await svc._withBrowser(async page => {
    await page.goto(`${svc.serverUrl}/Employee.aspx`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));
    const employees = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr[id*="DXDataRow"]'));
      return rows.map(r => {
        const cells = Array.from(r.querySelectorAll('td')).map(c => c.innerText.trim());
        return cells.filter(Boolean);
      });
    });
    console.log(`Employees in Employee.aspx (${employees.length}):`);
    employees.forEach(e => console.log('  ', e.join(' | ')));
  });
}

listEmployees().catch(console.error);
