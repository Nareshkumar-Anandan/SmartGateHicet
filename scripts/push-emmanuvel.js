const svc = require('../src/services/timewatchIdmsService');
const path = require('path');

async function pushEmmanuvel() {
  console.log('Pushing Emmanuvel simson (PIN: 8, Reg: 720826105011) to turnstiles...');
  const res = await svc.pushStudentToTurnstiles({
    pin: '8',
    name: 'Emmanuvel simson',
    department: 'BE Mechanical Engineering',
    cardNumber: '0',
    photoPath: path.resolve(__dirname, '../uploads/students/720826105011.jpg')
  });
  console.log('Push result:', res);
}

pushEmmanuvel().catch(console.error);
