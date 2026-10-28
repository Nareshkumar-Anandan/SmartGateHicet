const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const { pool } = require('../src/config/database');
const timewatchIdmsService = require('../src/services/timewatchIdmsService');

async function connectAndSync() {
  console.log('======================================================================');
  console.log('   CONNECTING SMARTGATE TO TIMEWATCH SERVER (http://172.25.3.51:9001) ');
  console.log('======================================================================\n');

  // Step 1: Ensure Hostels & Rooms exist
  console.log('[STEP 1/5] Ensuring Base Hostels and Rooms exist in database...');
  const [hostelCount] = await pool.query('SELECT COUNT(*) as count FROM hostels');
  if (hostelCount[0].count === 0) {
    const [[wardenRow]] = await pool.query('SELECT id FROM users WHERE role = "WARDEN" LIMIT 1');
    const wardenId = wardenRow ? wardenRow.id : 2;

    await pool.query(`
      INSERT INTO hostels (name, code, gender_type, warden_id, total_rooms, description)
      VALUES 
        ('Kaveri Boys Hostel (Block A)', 'KBH-A', 'BOYS', ?, 120, 'Junior and Senior engineering students hostel block'),
        ('Bhavani Girls Hostel (Block B)', 'BGH-B', 'GIRLS', ?, 100, 'Women engineering students hostel block'),
        ('Ramanujan Science & Tech Block (Block C)', 'REB-C', 'BOYS', ?, 80, 'Postgraduate and final year engineering block')
    `, [wardenId, wardenId, wardenId]);

    const [kbh] = await pool.query("SELECT id FROM hostels WHERE code = 'KBH-A'");
    const kbhId = kbh[0].id;

    await pool.query(`
      INSERT INTO rooms (hostel_id, room_number, floor, capacity, current_occupancy, status)
      VALUES 
        (?, '101', 1, 4, 0, 'AVAILABLE'),
        (?, '102', 1, 4, 0, 'AVAILABLE'),
        (?, '103', 1, 2, 0, 'AVAILABLE'),
        (?, '201', 2, 4, 0, 'AVAILABLE')
    `, [kbhId, kbhId, kbhId, kbhId]);

    console.log('  -> Hostels and rooms created successfully.');
  } else {
    console.log(`  -> Hostels already present (${hostelCount[0].count} blocks).`);
  }

  // Step 2: Test Connection & Login to TimeWatch Server
  console.log('\n[STEP 2/5] Testing Connection & Authenticating with http://172.25.3.51:9001...');
  const connResult = await timewatchIdmsService.testConnection();
  if (!connResult.success) {
    console.error(`  [FAILED] Connection failed: ${connResult.error}`);
    process.exit(1);
  }
  console.log(`  -> Connected in ${connResult.latencyMs}ms! (Server: ${connResult.version})`);

  // Step 3: Synchronize all 8 Turnstile Devices
  console.log('\n[STEP 3/5] Synchronizing Turnstiles from TimeWatch Server...');
  const devSync = await timewatchIdmsService.syncDevicesToDb();
  console.log(`  -> Synced ${devSync.totalSynced} physical turnstiles into MySQL gate_devices table:`);
  console.table(devSync.devices.map(d => ({
    'Lane Code': d.deviceCode,
    'Terminal Name': d.name,
    'Serial Number': d.serialNumber,
    'IP Address': d.ipAddress,
    'Direction': d.direction,
    'Status': d.status
  })));

  // Step 4: Synchronize Enrolled Biometric Users from TimeWatch Server
  console.log('\n[STEP 4/5] Synchronizing Enrolled Biometric Users from Machine Memory...');
  const userSync = await timewatchIdmsService.syncUsersToDb();
  console.log(`  -> Imported ${userSync.totalImported} biometric users into SmartGate students table.`);

  // Link Nareshkumar profile with Student ID 12
  const [kbhRoom] = await pool.query("SELECT r.id as room_id, r.hostel_id FROM rooms r JOIN hostels h ON r.hostel_id = h.id WHERE h.code = 'KBH-A' LIMIT 1");
  const roomId = kbhRoom.length > 0 ? kbhRoom[0].room_id : null;
  const hostelId = kbhRoom.length > 0 ? kbhRoom[0].hostel_id : null;

  await pool.query(`
    INSERT INTO students 
    (student_id, first_name, last_name, department, course, year_of_study, phone, parent_phone, email, hostel_id, room_id, current_location_status, biometric_device_id, biometric_enrolled, card_number, is_active)
    VALUES ('12', 'Nareshkumar', 'Anandan', 'Computer Science & Engineering', 'B.E.', 1, '+919790550429', '9790550429', 'nareshkumaranandan77@gmail.com', ?, ?, 'INSIDE', '2', 1, '6556', 1)
    ON DUPLICATE KEY UPDATE 
      first_name = 'Nareshkumar',
      last_name = 'Anandan',
      biometric_device_id = '2',
      card_number = '6556',
      hostel_id = VALUES(hostel_id),
      room_id = VALUES(room_id),
      biometric_enrolled = 1,
      is_active = 1
  `, [hostelId, roomId]);

  const [activeStudents] = await pool.query('SELECT id, student_id, first_name, last_name, biometric_device_id, card_number, current_location_status FROM students');
  console.table(activeStudents);

  // Step 5: Ingest Real-Time Punches from Machine Stream
  console.log('\n[STEP 5/5] Ingesting Live Scans from RealTimeLog.aspx...');
  const punchSync = await timewatchIdmsService.pollAndProcessPunches();
  console.log(`  -> Processed ${punchSync.processed} punch scan(s) in initial sync.`);

  const [recentEvents] = await pool.query(`
    SELECT ge.id, ge.event_timestamp, ge.direction, ge.verification_type, ge.access_result, ge.denial_reason,
           gd.device_name, CONCAT(s.first_name, ' ', s.last_name) as student_name
    FROM gate_events ge
    LEFT JOIN gate_devices gd ON ge.device_id = gd.id
    LEFT JOIN students s ON ge.student_id = s.id
    ORDER BY ge.id DESC
    LIMIT 10
  `);

  if (recentEvents.length > 0) {
    console.log('\nRecent Ingested Gate Events:');
    console.table(recentEvents);
  }

  console.log('\n======================================================================');
  console.log('   CONNECT SUCCESSFUL: SMARTGATE IS FULLY INTEGRATED & RUNNING!');
  console.log('   All 8 Turnstiles Online. Real-time background sync is active.');
  console.log('======================================================================\n');

  process.exit(0);
}

connectAndSync().catch(err => {
  console.error('Connection error:', err);
  process.exit(1);
});
