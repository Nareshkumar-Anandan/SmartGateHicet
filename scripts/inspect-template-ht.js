const http = require('http');
const svc = require('../src/services/timewatchIdmsService');

(async () => {
  const cookie = await svc.login();
  http.get({ hostname: '172.25.3.51', port: 9001, path: '/frmTemplateHTSeries.aspx', headers: { Cookie: cookie } }, res => {
    let b = '';
    res.on('data', c => b += c);
    res.on('end', () => {
      const headers = b.match(/<td[^>]*class="dxgvHeader_MetropolisBlue"[^>]*>[\s\S]*?<\/td>/gi) || [];
      console.log('Headers:', headers.map(h => h.replace(/<[^>]+>/g, '').trim()).filter(Boolean));
      const rows = b.match(/<tr id="ContentPlaceHolder1_ASPxGridView1_DXDataRow\d+"[\s\S]*?<\/tr>/gi) || [];
      console.log('Total rows on page 1:', rows.length);
      rows.slice(0, 5).forEach((r, i) => console.log(`Row ${i}:`, r.replace(/<[^>]+>/g, ' | ').replace(/\s+/g, ' ').trim()));
      process.exit(0);
    });
  });
})();
