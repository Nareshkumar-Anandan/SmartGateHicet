const svc = require('../src/services/timewatchIdmsService');
const http = require('http');

(async () => {
  const cookie = await svc.login();
  http.get({ hostname: '172.25.3.51', port: 9001, path: '/frmTemplateHTSeries.aspx', headers: { Cookie: cookie } }, res => {
    let b = '';
    res.on('data', c => b += c);
    res.on('end', () => {
      // Find pager or total rows
      const pager = b.match(/class="dxp-lead dxp-summary"[\s\S]*?<\/b>/i);
      console.log('Pager:', pager ? pager[0].replace(/<[^>]+>/g, '') : 'none');
      
      // Look for User IDs in table
      const rows = b.match(/<tr id="ContentPlaceHolder1_ASPxGridView1_DXDataRow\d+"[\s\S]*?<\/tr>/gi) || [];
      const userIds = rows.map(r => {
        const cells = (r.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || []).map(c => c.replace(/<[^>]+>/g, '').trim());
        return cells[1] || cells[0];
      });
      console.log('User IDs in GridView1 (first 20):', [...new Set(userIds)].slice(0, 20));
      process.exit(0);
    });
  });
})();
