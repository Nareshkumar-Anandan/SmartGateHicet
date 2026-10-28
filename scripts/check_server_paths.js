const http = require('http');
const svc = require('../src/services/timewatchIdmsService');

const paths = [
  '/UserPhoto/8.jpg',
  '/Photo/8.jpg',
  '/Photos/8.jpg',
  '/Upload/8.jpg',
  '/Uploads/8.jpg',
  '/Image/8.jpg',
  '/Images/8.jpg',
  '/UserImage/8.jpg',
  '/UserImages/8.jpg',
  '/EmpPhoto/8.jpg',
  '/EmployeePhoto/8.jpg',
  '/Temp/8.jpg',
  '/8.jpg',
  '/DownloadUser.aspx/8.jpg'
];

(async () => {
  const cookie = await svc.login();
  for (const p of paths) {
    await new Promise(r => {
      http.get({ hostname: '172.25.3.51', port: 9001, path: p, headers: { Cookie: cookie } }, res => {
        if (res.statusCode !== 404) {
          console.log(`Path ${p} => Status: ${res.statusCode}, Type: ${res.headers['content-type']}, Length: ${res.headers['content-length']}`);
        }
        res.resume();
        r();
      }).on('error', () => r());
    });
  }
  console.log('Done checking paths');
  process.exit(0);
})();
