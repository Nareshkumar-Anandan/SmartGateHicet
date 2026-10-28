const http = require('http');
const fs = require('fs');
const path = require('path');
const svc = require('../src/services/timewatchIdmsService');

(async () => {
  const cookie = await svc.login();
  const file = fs.createWriteStream(path.resolve(__dirname, 'ExcelUpdate.xls'));
  http.get({ hostname: '172.25.3.51', port: 9001, path: '/ExcelUpdate.xls', headers: { Cookie: cookie } }, res => {
    console.log('Status:', res.statusCode, res.headers['content-type'], res.headers['content-length']);
    res.pipe(file);
    file.on('finish', () => {
      file.close();
      console.log('Saved ExcelUpdate.xls');
      try {
        const xlsx = require('xlsx');
        const workbook = xlsx.readFile(path.resolve(__dirname, 'ExcelUpdate.xls'));
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
        console.log('Headers:', data[0]);
        console.log('Sample rows:', data.slice(1, 5));
      } catch (err) {
        console.error('Error parsing xls:', err.message);
      }
      process.exit(0);
    });
  });
})();
