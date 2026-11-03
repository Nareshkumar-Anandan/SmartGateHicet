const bcrypt = require('bcryptjs');
const { pool, ensureSchemaColumns } = require('../config/database');

async function seedDatabase() {
  console.log('--- Starting SmartGate Production Database Seeding (No Fake/Test Data) ---');

  // Ensure all required student table columns exist
  await ensureSchemaColumns();

  // 0. Remove any previously seeded fake/testing data (simulated events, test students, test rooms, test outings)
  const testStudentIds = [
    '720721104001',
    '720721104015',
    '720721106022',
    '720721104033',
    '720721104048',
    '720721102008',
    '720721106050',
    '720721104065'
  ];

  await pool.query("DELETE FROM gate_events WHERE event_source = 'SIMULATED'");
  await pool.query(
    `DELETE FROM incidents WHERE title IN (
      'Exit Attempt Without Valid Outing Approval',
      'Curfew Overdue Alert - Vignesh Chandran'
    )`
  );
  await pool.query(
    `DELETE FROM outings WHERE student_id IN (
      SELECT id FROM students WHERE student_id IN (?)
    )`,
    [testStudentIds]
  );
  await pool.query('DELETE FROM students WHERE student_id IN (?)', [testStudentIds]);
  await pool.query(
    `DELETE FROM rooms WHERE hostel_id IN (
      SELECT id FROM hostels WHERE code IN ('KBH-A', 'BGH-B', 'REB-C')
    )`
  );
  await pool.query("DELETE FROM hostels WHERE code IN ('KBH-A', 'BGH-B', 'REB-C')");
  await pool.query("DELETE FROM audit_logs WHERE actor_name IN ('System Initializer', 'Dr. S. K. Raman')");
  console.log('Cleaned up any legacy testing students, rooms, hostels, outings, and simulated gate entries.');

  // 1. Initial Application Accounts
  const [existingAdmin] = await pool.query('SELECT id, email FROM users WHERE email = ?', ['admin@hicet.ac.in']);
  const [existingWarden] = await pool.query('SELECT id, email FROM users WHERE email = ?', ['warden@hicet.ac.in']);

  if (existingAdmin.length === 0) {
    const adminHash = await bcrypt.hash('admin123', 10);
    await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, phone, must_change_password, is_active)
       VALUES (?, ?, ?, 'SUPER_ADMIN', ?, 0, 1)`,
      ['admin@hicet.ac.in', adminHash, 'System Super Administrator', '+91 98422 10001']
    );
    console.log('Super Admin account created (admin@hicet.ac.in).');
  } else {
    console.log('Super Admin account already exists.');
  }

  if (existingWarden.length === 0) {
    const wardenHash = await bcrypt.hash('warden123', 10);
    await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, phone, must_change_password, is_active)
       VALUES (?, ?, ?, 'WARDEN', ?, 0, 1)`,
      ['warden@hicet.ac.in', wardenHash, 'Hostel Warden', '+91 98422 20002']
    );
    console.log('Warden account created (warden@hicet.ac.in).');
  } else {
    console.log('Warden account already exists.');
  }

  // 2. System Settings
  const defaultSettings = [
    ['institution_name', 'Hindusthan Institute of Technology', 'Institution official name'],
    ['campus_location', 'Othakkalmandapam, Coimbatore, Tamil Nadu - 641032', 'Hostel campus location'],
    ['curfew_time', '20:30:00', 'Standard student hostel return curfew time'],
    ['turnstile_pulse_ms', '3000', 'Hardware turnstile solenoid unlock relay duration in milliseconds'],
    ['emergency_lockdown', 'NORMAL', 'Emergency mode: NORMAL, OPEN_ALL (Free egress), LOCKDOWN'],
    ['auto_dedup_window_seconds', '5', 'Window to suppress duplicate face recognitions'],
    ['max_daily_local_outings', '2', 'Maximum local outing passes per student per day']
  ];

  for (const [key, val, desc] of defaultSettings) {
    await pool.query(
      `INSERT INTO system_settings (setting_key, setting_value, description)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE description = VALUES(description)`,
      [key, val, desc]
    );
  }
  console.log('Default system settings seeded.');

  // 3. Real Hardware Gate Devices (8 TimeWatch TrueFace3000 Terminals on VLAN 172.25.26.241 - 172.25.26.248)
  const devices = [
    {
      code: 'TW-TF3000-LANE1',
      name: 'Hostel Main Gate - Lane 1 (Admin Exit)',
      mfg: 'TimeWatch',
      model: 'TrueFace3000 (ADPM)',
      sn: 'TW30000006260161',
      ip: '172.25.26.241',
      port: 8080,
      mac: '84:F3:EB:32:01:A1',
      loc: 'Main Hostel Arch Gate - Lane 1 Admin Exit Turnstile',
      dir: 'EXIT',
      pin: 1
    },
    {
      code: 'TW-TF3000-LANE2',
      name: 'Hostel Main Gate - Lane 2 (Entry)',
      mfg: 'TimeWatch',
      model: 'TrueFace3000 (ADPM)',
      sn: 'TW30000006260175',
      ip: '172.25.26.242',
      port: 8080,
      mac: '84:F3:EB:32:01:A2',
      loc: 'Main Hostel Arch Gate - Lane 2 Entry Turnstile',
      dir: 'ENTRY',
      pin: 2
    },
    {
      code: 'TW-TF3000-LANE3',
      name: 'Hostel Main Gate - Lane 3 (Exit)',
      mfg: 'TimeWatch',
      model: 'TrueFace3000 (ADPM)',
      sn: 'TW30000006260156',
      ip: '172.25.26.243',
      port: 8080,
      mac: '84:F3:EB:32:01:A3',
      loc: 'Main Hostel Arch Gate - Lane 3 Exit Turnstile',
      dir: 'EXIT',
      pin: 3
    },
    {
      code: 'TW-TF3000-LANE4',
      name: 'Hostel Main Gate - Lane 4 (Entry)',
      mfg: 'TimeWatch',
      model: 'TrueFace3000 (ADPM)',
      sn: 'TW30000006260127',
      ip: '172.25.26.244',
      port: 8080,
      mac: '84:F3:EB:32:01:A4',
      loc: 'Main Hostel Arch Gate - Lane 4 Entry Turnstile',
      dir: 'ENTRY',
      pin: 4
    },
    {
      code: 'TW-TF3000-LANE5',
      name: 'Hostel Main Gate - Lane 5 (Exit)',
      mfg: 'TimeWatch',
      model: 'TrueFace3000 (ADPM)',
      sn: 'TW30000006260207',
      ip: '172.25.26.245',
      port: 8080,
      mac: '84:F3:EB:32:01:A5',
      loc: 'Main Hostel Arch Gate - Lane 5 Exit Turnstile',
      dir: 'EXIT',
      pin: 1
    },
    {
      code: 'TW-TF3000-LANE6',
      name: 'Hostel Main Gate - Lane 6 (Entry)',
      mfg: 'TimeWatch',
      model: 'TrueFace3000 (ADPM)',
      sn: 'TW30000006260242',
      ip: '172.25.26.246',
      port: 8080,
      mac: '84:F3:EB:32:01:A6',
      loc: 'Main Hostel Arch Gate - Lane 6 Entry Turnstile',
      dir: 'ENTRY',
      pin: 2
    },
    {
      code: 'TW-TF3000-LANE7',
      name: 'Hostel Main Gate - Lane 7 (Exit)',
      mfg: 'TimeWatch',
      model: 'TrueFace3000 (ADPM)',
      sn: 'TW30000006260265',
      ip: '172.25.26.247',
      port: 8080,
      mac: '84:F3:EB:32:01:A7',
      loc: 'Main Hostel Arch Gate - Lane 7 Exit Turnstile',
      dir: 'EXIT',
      pin: 3
    },
    {
      code: 'TW-TF3000-LANE8',
      name: 'Hostel Main Gate - Lane 8 (Entry)',
      mfg: 'TimeWatch',
      model: 'TrueFace3000 (ADPM)',
      sn: 'TW30000006260256',
      ip: '172.25.26.248',
      port: 8080,
      mac: '84:F3:EB:32:01:A8',
      loc: 'Main Hostel Arch Gate - Lane 8 Entry Turnstile',
      dir: 'ENTRY',
      pin: 4
    }
  ];

  for (const d of devices) {
    await pool.query(
      `INSERT INTO gate_devices (device_code, device_name, manufacturer, model, serial_number, ip_address, port, mac_address, location_description, lane_direction, turnstile_relay_pin, status, last_heartbeat, integration_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OFFLINE', NULL, 'HARDWARE_API')
       ON DUPLICATE KEY UPDATE
         device_name = VALUES(device_name),
         serial_number = VALUES(serial_number),
         ip_address = VALUES(ip_address),
         lane_direction = VALUES(lane_direction),
         location_description = VALUES(location_description),
         integration_mode = 'HARDWARE_API'`,
      [d.code, d.name, d.mfg, d.model, d.sn, d.ip, d.port, d.mac, d.loc, d.dir, d.pin]
    );
  }
  console.log('Real TimeWatch TrueFace3000 gate devices seeded.');

  console.log('--- SmartGate Production Database Seeding Completed Successfully! ---\n');
  process.exit(0);
}

seedDatabase().catch(err => {
  console.error('Database Seeding Failed:', err);
  process.exit(1);
});
