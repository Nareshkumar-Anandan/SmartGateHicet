const { pool } = require('../src/config/database');

(async () => {
  const [rows] = await pool.query("SELECT id, student_id, first_name, last_name, biometric_device_id FROM students WHERE biometric_device_id = '155'");
  console.log('Students with bioId 155:', rows);
  process.exit(0);
})();
