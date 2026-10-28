const http = require('http');

const dirs = [
  '/UserPhoto/',
  '/Upload/',
  '/Uploads/',
  '/Photos/',
  '/UserPhotos/',
  '/Photo/',
  '/Images/',
  '/Image/',
  '/Face/',
  '/Faces/',
  '/Template/',
  '/Templates/',
  '/Pic/',
  '/Pics/',
  '/EmpPhoto/',
  '/EmployeePhoto/'
];

async function check() {
  for (const d of dirs) {
    await new Promise(resolve => {
      http.get(`http://172.25.3.51:9001${d}`, res => {
        console.log(d, '->', res.statusCode);
        resolve();
      }).on('error', err => {
        console.log(d, '-> Error:', err.message);
        resolve();
      });
    });
  }
}

check();
