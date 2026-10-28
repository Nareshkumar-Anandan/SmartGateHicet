const { pool } = require('../src/config/database');

(async () => {
  await pool.query('DELETE FROM students');
  await pool.query('DELETE FROM gate_events');
  await pool.query('DELETE FROM outings');
  await pool.query("UPDATE rooms SET current_occupancy = 0, status = 'AVAILABLE'");

  const [s] = await pool.query('SELECT COUNT(*) as count FROM students');
  const [e] = await pool.query('SELECT COUNT(*) as count FROM gate_events');
  const [o] = await pool.query('SELECT COUNT(*) as count FROM outings');

  console.log('Final DB Status:');
  console.log('Students count:', s[0].count);
  console.log('Gate Events count:', e[0].count);
  console.log('Outings count:', o[0].count);

  process.exit(0);
})();
