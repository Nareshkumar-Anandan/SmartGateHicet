const http = require('http');
const svc = require('../src/services/timewatchIdmsService');

(async () => {
  const cookie = await svc.login();
  http.get({ hostname: '172.25.3.51', port: 9001, path: '/UserList.aspx', headers: { Cookie: cookie } }, res => {
    let b = '';
    res.on('data', c => b += c);
    res.on('end', () => {
      const rows = b.match(/<tr id="ContentPlaceHolder1_ASPxGridView1_DXDataRow\d+"[\s\S]*?<\/tr>/gi) || [];
      console.log('UserList total rows:', rows.length);
      rows.forEach((r, i) => {
        const text = r.replace(/<[^>]+>/g, ' | ').replace(/\s+/g, ' ').trim();
        if (text.includes('| 8 |') || text.toLowerCase().includes('emmanuvel') || i < 8) {
          console.log(`${i}: ${text}`);
        }
      });
      process.exit(0);
    });
  });
})();
