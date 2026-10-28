const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const { pool } = require('../src/config/database');

async function cleanDatabase() {
  console.log('--- Cleaning SmartGate Database ---');
  console.log('Preserving users (login credentials) and system settings...\n');

  const connection = await pool.getConnection();

  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');

    const tablesToClear = [
      'gate_events',
      'incidents',
      'outings',
      'audit_logs',
      'students',
      'rooms',
      'hostels',
      'gate_devices'
    ];

    for (const table of tablesToClear) {
      await connection.query(`TRUNCATE TABLE ${table}`);
      console.log(`[CLEARED] Table: ${table}`);
    }

    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('\nAll transactional, student, hostel, and hardware device tables have been cleared.');

    // Verify final state
    console.log('\n--- Current Database Summary ---');
    const allTables = [
      'users',
      'system_settings',
      'hostels',
      'rooms',
      'students',
      'outings',
      'gate_devices',
      'gate_events',
      'incidents',
      'audit_logs'
    ];

    for (const t of allTables) {
      const [rows] = await connection.query(`SELECT COUNT(*) as count FROM ${t}`);
      console.log(`  ${t.padEnd(18)}: ${rows[0].count} records`);
    }

    const [userRows] = await connection.query('SELECT id, email, full_name, role FROM users');
    console.log('\nPreserved Active User Accounts:');
    userRows.forEach(u => {
      console.log(`  - [ID ${u.id}] ${u.email} (${u.role}) - ${u.full_name}`);
    });

    console.log('\nDatabase cleanup completed successfully.');
  } catch (error) {
    console.error('Error during database cleanup:', error);
    process.exit(1);
  } finally {
    connection.release();
    process.exit(0);
  }
}

cleanDatabase();
