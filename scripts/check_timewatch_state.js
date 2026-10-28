const svc = require('../src/services/timewatchIdmsService');
const http = require('http');

(async () => {
  const cookie = await svc.login();
  function get(p) {
    return new Promise((resolve, reject) => {
      http.get({ hostname: '172.25.3.51', port: 9001, path: p, headers: { Cookie: cookie } }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => resolve(d));
      }).on('error', reject);
    });
  }

  // 1. Check UserList.aspx
  const ul = await get('/UserList.aspx');
  const ulRows = ul.match(/<tr id="ContentPlaceHolder1_ASPxGridView1_DXDataRow\d+"[\s\S]*?<\/tr>/gi) || [];
  console.log(`\n=== UserList.aspx (${ulRows.length} rows) ===`);
  ulRows.forEach((r, i) => {
    const text = r.replace(/<[^>]+>/g, ' | ').replace(/\s+/g, ' ').trim();
    if (text.includes('| 8 |')) {
      console.log(`Row ${i}: ${text}`);
    }
  });

  // 2. Check frmTemplateHTSeries.aspx
  const tmpl = await get('/frmTemplateHTSeries.aspx');
  const tmplRows = tmpl.match(/<tr id="ContentPlaceHolder1_ASPxGridView1_DXDataRow\d+"[\s\S]*?<\/tr>/gi) || [];
  console.log(`\n=== frmTemplateHTSeries.aspx (${tmplRows.length} rows) ===`);
  tmplRows.forEach((r, i) => {
    const text = r.replace(/<[^>]+>/g, ' | ').replace(/\s+/g, ' ').trim();
    if (text.includes('| 8 |')) {
      console.log(`Row ${i}: ${text}`);
    }
  });

  process.exit(0);
})();
