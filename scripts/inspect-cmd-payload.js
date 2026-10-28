const svc = require('../src/services/timewatchIdmsService');
const http = require('http');

(async () => {
  const cookie = await svc.login();
  http.get({ hostname: '172.25.3.51', port: 9001, path: '/DeviceCommand.aspx', headers: { Cookie: cookie } }, res => {
    let b = '';
    res.on('data', c => b += c);
    res.on('end', () => {
      const rows = b.match(/<tr id="ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXDataRow\d+"[\s\S]*?<\/tr>/gi) || [];
      console.log(`Top 10 commands with all cells:`);
      rows.slice(0, 10).forEach((r, i) => {
        const cells = (r.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || []).map(c => c.replace(/<[^>]+>/g, '').trim());
        console.log(`CMD ${i}: ID=${cells[1]} | Dev=${cells[3]} | Cmd=${cells[4]} | Data=${cells[5]} | Exec=${cells[8]} | Prio=${cells[7]}`);
      });
      process.exit(0);
    });
  });
})();
