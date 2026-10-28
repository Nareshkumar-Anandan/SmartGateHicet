const path = require('path');
const timewatchIdmsService = require('../src/services/timewatchIdmsService');

(async () => {
  const photoPath = path.resolve(__dirname, '../uploads/students/720826105011.jpg');
  console.log('Testing pushStudentPhotoToTurnstiles for Emmanuvel Simson...');
  console.log('Photo path:', photoPath);

  const res = await timewatchIdmsService.pushStudentPhotoToTurnstiles({
    pin: '8',
    name: 'Emmanuvel simson',
    photoPath
  });

  console.log('Result:', JSON.stringify(res, null, 2));
  process.exit(0);
})();
