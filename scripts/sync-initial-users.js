const { pool } = require('../src/config/database');

async function run() {
  await pool.query(`
    UPDATE students 
    SET biometric_device_id = '2', card_number = '6556', biometric_enrolled = 1 
    WHERE id = 5
  `);

  const sampleUsers = [
    { bioId: '3', name: 'Shyam Sundar', card: '123', email: 'shyam@hicet.ac.in' },
    { bioId: '4', name: 'D. Chelladurai', card: '4567', email: 'chelladurai@hicet.ac.in' },
    { bioId: '6', name: 'Jana Raman', card: '7890', email: 'jana@hicet.ac.in' }
  ];

  for (const u of sampleUsers) {
    const parts = u.name.split(' ');
    await pool.query(`
      INSERT INTO students 
      (student_id, first_name, last_name, department, course, year_of_study, phone, parent_phone, email, current_location_status, biometric_device_id, biometric_enrolled, card_number, is_active)
      VALUES (?, ?, ?, 'Computer Science', 'B.E.', 2, '9876543210', '9876543210', ?, 'INSIDE', ?, 1, ?, 1)
      ON DUPLICATE KEY UPDATE 
        first_name = VALUES(first_name),
        last_name = VALUES(last_name),
        biometric_device_id = VALUES(biometric_device_id),
        card_number = VALUES(card_number),
        biometric_enrolled = 1
    `, ['TW-' + u.bioId, parts[0], parts.slice(1).join(' '), u.email, u.bioId, u.card]);
  }

  const [rows] = await pool.query("SELECT id, student_id, first_name, last_name, biometric_device_id, card_number FROM students WHERE biometric_device_id IN ('2', '3', '4', '6')");
  console.log('--- Synced Enrolled Users from TimeWatch Server ---');
  console.table(rows);
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
