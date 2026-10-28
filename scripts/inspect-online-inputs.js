const http = require('http');
const svc = require('../src/services/timewatchIdmsService');
const fs = require('fs');

(async () => {
  const cookie = await svc.login();
  http.get({ hostname: '172.25.3.51', port: 9001, path: '/OnlineEnrollment.aspx', headers: { Cookie: cookie } }, res => {
    let b = '';
    res.on('data', c => b += c);
    res.on('end', () => {
      fs.writeFileSync('backend/scripts/page__OnlineEnrollment_aspx.html', b);
      console.log('Saved page__OnlineEnrollment_aspx.html, size:', b.length);
      const inputs = b.match(/id="ContentPlaceHolder1_[^"]*"/gi) || [];
      console.log('OnlineEnrollment inputs:', inputs);
      process.exit(0);
    });
  });
})();
