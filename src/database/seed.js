const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool, withTransaction } = require('../config/database');

function generateSecureTempPassword(prefix = 'Hicet') {
  const randomChars = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}#${randomChars}`;
}

async function seedDatabase() {
  console.log('--- Starting SmartGate Database Seeding ---');

  // 1. Initial Application Accounts
  const [existingAdmin] = await pool.query('SELECT id, email FROM users WHERE email = ?', ['admin@hicet.ac.in']);
  const [existingWarden] = await pool.query('SELECT id, email FROM users WHERE email = ?', ['warden@hicet.ac.in']);

  let adminCreds = null;
  let wardenCreds = null;

  if (existingAdmin.length === 0) {
    const adminTempPass = generateSecureTempPassword('Admin');
    const adminHash = await bcrypt.hash(adminTempPass, 10);
    const [res] = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, phone, must_change_password, is_active)
       VALUES (?, ?, ?, 'SUPER_ADMIN', ?, 1, 1)`,
      ['admin@hicet.ac.in', adminHash, 'System Super Administrator', '+91 98422 10001']
    );
    adminCreds = { email: 'admin@hicet.ac.in', tempPassword: adminTempPass, role: 'SUPER_ADMIN', id: res.insertId };
  } else {
    console.log('Super Admin account already exists (skipping creation).');
  }

  if (existingWarden.length === 0) {
    const wardenTempPass = generateSecureTempPassword('Warden');
    const wardenHash = await bcrypt.hash(wardenTempPass, 10);
    const [res] = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, phone, must_change_password, is_active)
       VALUES (?, ?, ?, 'WARDEN', ?, 1, 1)`,
      ['warden@hicet.ac.in', wardenHash, 'Chief Hostel Warden - Dr. S. K. Raman', '+91 98422 20002']
    );
    wardenCreds = { email: 'warden@hicet.ac.in', tempPassword: wardenTempPass, role: 'WARDEN', id: res.insertId };
  } else {
    console.log('Warden account already exists (skipping creation).');
  }

  // Save generated credentials to secure text file if new accounts were created
  if (adminCreds || wardenCreds) {
    const credsPath = path.join(__dirname, '../../initial_credentials.txt');
    let credsContent = `========================================================\n`;
    credsContent += `SMARTGATE SYSTEM - INITIAL TEMPORARY CREDENTIALS\n`;
    credsContent += `Generated at: ${new Date().toISOString()}\n`;
    credsContent += `Institution: Hindusthan Institute of Technology (HICET)\n`;
    credsContent += `NOTE: Both accounts must change passwords upon initial login.\n`;
    credsContent += `========================================================\n\n`;

    if (adminCreds) {
      credsContent += `Role: SUPER ADMIN\n`;
      credsContent += `Email: ${adminCreds.email}\n`;
      credsContent += `Temporary Password: ${adminCreds.tempPassword}\n\n`;
    }
    if (wardenCreds) {
      credsContent += `Role: WARDEN\n`;
      credsContent += `Email: ${wardenCreds.email}\n`;
      credsContent += `Temporary Password: ${wardenCreds.tempPassword}\n\n`;
    }
    credsContent += `========================================================\n`;

    fs.writeFileSync(credsPath, credsContent, 'utf8');
    console.log('\n[SECURITY NOTICE] Temporary credentials generated and stored at backend/initial_credentials.txt:');
    if (adminCreds) console.log(`  Admin:  ${adminCreds.email} | Temp Pass: ${adminCreds.tempPassword}`);
    if (wardenCreds) console.log(`  Warden: ${wardenCreds.email} | Temp Pass: ${wardenCreds.tempPassword}`);
  }

  // Fetch warden id for assignment
  const [[wardenRow]] = await pool.query('SELECT id FROM users WHERE email = ?', ['warden@hicet.ac.in']);
  const wardenId = wardenRow ? wardenRow.id : null;

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

  // 3. Hostels
  const hostels = [
    ['Kaveri Boys Hostel (Block A)', 'KBH-A', 'BOYS', wardenId, 120, 'Junior and Senior engineering students hostel block'],
    ['Bhavani Girls Hostel (Block B)', 'BGH-B', 'GIRLS', wardenId, 100, 'Women engineering students hostel block'],
    ['Ramanujan Science & Tech Block (Block C)', 'REB-C', 'BOYS', wardenId, 80, 'Postgraduate and final year engineering block']
  ];

  for (const [name, code, gender, wId, rooms, desc] of hostels) {
    await pool.query(
      `INSERT INTO hostels (name, code, gender_type, warden_id, total_rooms, description)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description)`,
      [name, code, gender, wId, rooms, desc]
    );
  }
  console.log('Hostels seeded.');

  // Fetch hostel IDs
  const [hostelRows] = await pool.query('SELECT id, code FROM hostels');
  const hostelMap = {};
  hostelRows.forEach(h => { hostelMap[h.code] = h.id; });

  // 4. Rooms
  const sampleRooms = [
    { hostel: 'KBH-A', num: '101', floor: 1, cap: 4 },
    { hostel: 'KBH-A', num: '102', floor: 1, cap: 4 },
    { hostel: 'KBH-A', num: '103', floor: 1, cap: 2 },
    { hostel: 'KBH-A', num: '201', floor: 2, cap: 4 },
    { hostel: 'KBH-A', num: '202', floor: 2, cap: 4 },
    { hostel: 'BGH-B', num: 'G101', floor: 1, cap: 4 },
    { hostel: 'BGH-B', num: 'G102', floor: 1, cap: 4 },
    { hostel: 'BGH-B', num: 'G201', floor: 2, cap: 4 },
    { hostel: 'REB-C', num: '301', floor: 3, cap: 2 },
    { hostel: 'REB-C', num: '302', floor: 3, cap: 2 }
  ];

  for (const r of sampleRooms) {
    const hId = hostelMap[r.hostel];
    if (hId) {
      await pool.query(
        `INSERT INTO rooms (hostel_id, room_number, floor, capacity, current_occupancy, status)
         VALUES (?, ?, ?, ?, 0, 'AVAILABLE')
         ON DUPLICATE KEY UPDATE capacity = VALUES(capacity)`,
        [hId, r.num, r.floor, r.cap]
      );
    }
  }
  console.log('Rooms seeded.');

  // Fetch rooms for student assignment
  const [roomRows] = await pool.query('SELECT id, hostel_id, room_number, capacity FROM rooms');
  const roomMap = {};
  roomRows.forEach(r => { roomMap[`${r.hostel_id}_${r.room_number}`] = r; });

  // 5. Gate Devices (TimeWatch TrueFace3000 Terminals on VLAN Subnet 172.25.26.241 - 172.25.26.248)
  // Lane 1: Admin Exit, Lane 2: Entry, Lane 3: Exit, Lane 4: Entry, Lane 5: Exit, Lane 6: Entry, Lane 7: Exit, Lane 8: Entry
  const devices = [
    {
      code: 'TW-TF3000-LANE1',
      name: 'Hostel Main Gate - Lane 1 (Admin Exit)',
      mfg: 'TimeWatch',
      model: 'TrueFace3000 (ADPM)',
      sn: 'TW30000000260207',
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
      sn: 'TW30000000260208',
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
      sn: 'TW30000000260209',
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
      sn: 'TW30000000260210',
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
      sn: 'TW30000000260211',
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
      sn: 'TW30000000260212',
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
      sn: 'TW30000000260213',
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
      sn: 'TW30000000260214',
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
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ONLINE', NOW(), 'SIMULATED')
       ON DUPLICATE KEY UPDATE device_name = VALUES(device_name), ip_address = VALUES(ip_address), lane_direction = VALUES(lane_direction), location_description = VALUES(location_description), status = VALUES(status)`,
      [d.code, d.name, d.mfg, d.model, d.sn, d.ip, d.port, d.mac, d.loc, d.dir, d.pin]
    );
  }
  console.log('Gate devices seeded.');

  // 6. Students
  const students = [
    {
      sid: '720721104001',
      fn: 'Arun',
      ln: 'Kumar',
      dept: 'Computer Science & Engineering',
      course: 'B.E.',
      year: 3,
      phone: '+91 97890 12345',
      parent: '+91 94433 12345',
      email: 'arunkumar.720721104001@hicet.ac.in',
      hostelCode: 'KBH-A',
      roomNum: '101',
      loc: 'INSIDE',
      bioId: 'TW-UID-1001',
      card: 'CRD-882101'
    },
    {
      sid: '720721104015',
      fn: 'Karthik',
      ln: 'Subramanian',
      dept: 'Information Technology',
      course: 'B.Tech.',
      year: 3,
      phone: '+91 98401 23456',
      parent: '+91 94432 23456',
      email: 'karthik.720721104015@hicet.ac.in',
      hostelCode: 'KBH-A',
      roomNum: '101',
      loc: 'OUTSIDE',
      bioId: 'TW-UID-1002',
      card: 'CRD-882102'
    },
    {
      sid: '720721106022',
      fn: 'Praveen',
      ln: 'Raj',
      dept: 'Artificial Intelligence & Data Science',
      course: 'B.Tech.',
      year: 2,
      phone: '+91 99420 34567',
      parent: '+91 94431 34567',
      email: 'praveenraj.720721106022@hicet.ac.in',
      hostelCode: 'KBH-A',
      roomNum: '102',
      loc: 'INSIDE',
      bioId: 'TW-UID-1003',
      card: 'CRD-882103'
    },
    {
      sid: '720721104033',
      fn: 'Deepika',
      ln: 'Sundaram',
      dept: 'Computer Science & Engineering',
      course: 'B.E.',
      year: 3,
      phone: '+91 97865 45678',
      parent: '+91 94430 45678',
      email: 'deepika.720721104033@hicet.ac.in',
      hostelCode: 'BGH-B',
      roomNum: 'G101',
      loc: 'INSIDE',
      bioId: 'TW-UID-1004',
      card: 'CRD-882104'
    },
    {
      sid: '720721104048',
      fn: 'Sneha',
      ln: 'Muralidharan',
      dept: 'Electronics & Communication',
      course: 'B.E.',
      year: 4,
      phone: '+91 98940 56789',
      parent: '+91 94429 56789',
      email: 'sneha.720721104048@hicet.ac.in',
      hostelCode: 'BGH-B',
      roomNum: 'G101',
      loc: 'OUTSIDE',
      bioId: 'TW-UID-1005',
      card: 'CRD-882105'
    },
    {
      sid: '720721102008',
      fn: 'Vignesh',
      ln: 'Chandran',
      dept: 'Mechanical Engineering',
      course: 'B.E.',
      year: 4,
      phone: '+91 97910 67890',
      parent: '+91 94428 67890',
      email: 'vignesh.720721102008@hicet.ac.in',
      hostelCode: 'REB-C',
      roomNum: '301',
      loc: 'OUTSIDE',
      bioId: 'TW-UID-1006',
      card: 'CRD-882106'
    },
    {
      sid: '720721106050',
      fn: 'Harish',
      ln: 'Natarajan',
      dept: 'Artificial Intelligence & Data Science',
      course: 'B.Tech.',
      year: 1,
      phone: '+91 97500 78901',
      parent: '+91 94427 78901',
      email: 'harish.720721106050@hicet.ac.in',
      hostelCode: 'KBH-A',
      roomNum: '102',
      loc: 'INSIDE',
      bioId: 'TW-UID-1007',
      card: 'CRD-882107'
    },
    {
      sid: '720721104065',
      fn: 'Ananya',
      ln: 'Gopalan',
      dept: 'Information Technology',
      course: 'B.Tech.',
      year: 2,
      phone: '+91 98433 89012',
      parent: '+91 94426 89012',
      email: 'ananya.720721104065@hicet.ac.in',
      hostelCode: 'BGH-B',
      roomNum: 'G102',
      loc: 'INSIDE',
      bioId: 'TW-UID-1008',
      card: 'CRD-882108'
    }
  ];

  for (const s of students) {
    const hId = hostelMap[s.hostelCode];
    const roomKey = `${hId}_${s.roomNum}`;
    const rObj = roomMap[roomKey];
    const rId = rObj ? rObj.id : null;

    await pool.query(
      `INSERT INTO students (student_id, first_name, last_name, department, course, year_of_study, phone, parent_phone, email, hostel_id, room_id, current_location_status, biometric_device_id, biometric_enrolled, card_number, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1)
       ON DUPLICATE KEY UPDATE phone = VALUES(phone), current_location_status = VALUES(current_location_status)`,
      [s.sid, s.fn, s.ln, s.dept, s.course, s.year, s.phone, s.parent, s.email, hId, rId, s.loc, s.bioId, s.card]
    );
  }
  console.log('Students seeded.');

  // Update room occupancy counts
  await pool.query(`
    UPDATE rooms r
    SET current_occupancy = (SELECT COUNT(*) FROM students s WHERE s.room_id = r.id AND s.is_active = 1),
        status = CASE 
          WHEN (SELECT COUNT(*) FROM students s WHERE s.room_id = r.id AND s.is_active = 1) >= r.capacity THEN 'FULL'
          ELSE 'AVAILABLE'
        END
  `);
  console.log('Room occupancy updated.');

  // 7. Outings & Approvals
  const [studentRows] = await pool.query('SELECT id, student_id, first_name, last_name, current_location_status FROM students');
  const sMap = {};
  studentRows.forEach(s => { sMap[s.student_id] = s; });

  const todayStr = new Date().toISOString().split('T')[0];

  const sampleOutings = [
    // 1. Pending Outing
    {
      sid: '720721104001',
      type: 'LOCAL_OUTING',
      deptDate: todayStr,
      deptTime: '16:00:00',
      retDate: todayStr,
      retTime: '20:00:00',
      dest: 'Coimbatore City Center / Gandhipuram',
      reason: 'Purchasing semester reference textbooks and project electronics components',
      status: 'PENDING',
      remarks: null,
      decisionAt: null
    },
    // 2. Approved Outing (Outside now, within window)
    {
      sid: '720721104015',
      type: 'LOCAL_OUTING',
      deptDate: todayStr,
      deptTime: '14:00:00',
      retDate: todayStr,
      retTime: '20:30:00',
      dest: 'Brookefields Mall, Coimbatore',
      reason: 'Personal essentials and medical prescription pickup',
      status: 'APPROVED',
      remarks: 'Approved by Chief Warden. Adhere strictly to 8:30 PM curfew.',
      decisionAt: new Date(Date.now() - 3 * 3600 * 1000)
    },
    // 3. Overdue Outing (Student was supposed to return yesterday/earlier today!)
    {
      sid: '720721102008',
      type: 'LOCAL_OUTING',
      deptDate: todayStr,
      deptTime: '10:00:00',
      retDate: todayStr,
      retTime: '17:00:00', // Past return time!
      dest: 'Singanallur Bus Terminal & Market',
      reason: 'Family visit at bus terminal',
      status: 'OVERDUE',
      remarks: 'Approved. Expected back by 5:00 PM.',
      decisionAt: new Date(Date.now() - 8 * 3600 * 1000)
    },
    // 4. Completed Outing (Yesterday)
    {
      sid: '720721104033',
      type: 'LOCAL_OUTING',
      deptDate: todayStr,
      deptTime: '11:00:00',
      retDate: todayStr,
      retTime: '15:00:00',
      dest: 'Prozone Mall, Saravanampatti',
      reason: 'Book fair attendance and stationary purchase',
      status: 'COMPLETED',
      remarks: 'Approved. Returned safely before deadline.',
      decisionAt: new Date(Date.now() - 7 * 3600 * 1000)
    },
    // 5. Approved Home Leave (Student outside)
    {
      sid: '720721104048',
      type: 'HOME_LEAVE',
      deptDate: todayStr,
      deptTime: '09:00:00',
      retDate: new Date(Date.now() + 2 * 86400 * 1000).toISOString().split('T')[0],
      retTime: '18:00:00',
      dest: 'Hometown - Salem',
      reason: 'Attending elder sister wedding ceremony. Parent letter submitted.',
      status: 'APPROVED',
      remarks: 'Verified parent permission letter. Gate exit permitted.',
      decisionAt: new Date(Date.now() - 10 * 3600 * 1000)
    }
  ];

  for (const o of sampleOutings) {
    const st = sMap[o.sid];
    if (st) {
      const [existing] = await pool.query(
        'SELECT id FROM outings WHERE student_id = ? AND departure_date = ? AND destination = ?',
        [st.id, o.deptDate, o.dest]
      );
      if (existing.length === 0) {
        await pool.query(
          `INSERT INTO outings (student_id, outing_type, departure_date, departure_time, expected_return_date, expected_return_time, destination, reason, status, approved_by_user_id, approval_remarks, decision_at, created_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [st.id, o.type, o.deptDate, o.deptTime, o.retDate, o.retTime, o.dest, o.reason, o.status, wardenId, o.remarks, o.decisionAt, wardenId]
        );
      }
    }
  }
  console.log('Sample outings seeded.');

  // 8. Gate Events (Simulated events representing real turnstile scans)
  const [deviceRows] = await pool.query('SELECT id, device_code FROM gate_devices');
  const dMap = {};
  deviceRows.forEach(d => { dMap[d.device_code] = d.id; });

  const sampleEvents = [
    {
      uuid: crypto.randomUUID(),
      deviceCode: 'TW-TF3000-LANE3',
      sid: '720721104015',
      time: new Date(Date.now() - 2.5 * 3600 * 1000),
      dir: 'EXIT',
      vtype: 'FACE',
      result: 'GRANTED',
      reason: null,
      source: 'SIMULATED',
      dedup: crypto.createHash('md5').update('720721104015-EXIT-2.5h').digest('hex')
    },
    {
      uuid: crypto.randomUUID(),
      deviceCode: 'TW-TF3000-LANE3',
      sid: '720721102008',
      time: new Date(Date.now() - 7.5 * 3600 * 1000),
      dir: 'EXIT',
      vtype: 'FACE',
      result: 'GRANTED',
      reason: null,
      source: 'SIMULATED',
      dedup: crypto.createHash('md5').update('720721102008-EXIT-7.5h').digest('hex')
    },
    {
      uuid: crypto.randomUUID(),
      deviceCode: 'TW-TF3000-LANE2',
      sid: '720721104033',
      time: new Date(Date.now() - 4 * 3600 * 1000),
      dir: 'ENTRY',
      vtype: 'CARD',
      result: 'GRANTED',
      reason: null,
      source: 'SIMULATED',
      dedup: crypto.createHash('md5').update('720721104033-ENTRY-4h').digest('hex')
    },
    {
      uuid: crypto.randomUUID(),
      deviceCode: 'TW-TF3000-LANE1',
      sid: '720721104001',
      time: new Date(Date.now() - 1 * 3600 * 1000),
      dir: 'EXIT',
      vtype: 'FACE',
      result: 'DENIED',
      reason: 'No approved outing pass found. Outing status is PENDING.',
      source: 'SIMULATED',
      dedup: crypto.createHash('md5').update('720721104001-EXIT-DENIED').digest('hex')
    },
    {
      uuid: crypto.randomUUID(),
      deviceCode: 'TW-TF3000-LANE1',
      sid: null, // Unknown person / un-enrolled face
      time: new Date(Date.now() - 45 * 60 * 1000),
      dir: 'ENTRY',
      vtype: 'FACE',
      result: 'DENIED',
      reason: 'Unregistered face biometric template. Terminal match score < 80%.',
      source: 'SIMULATED',
      dedup: crypto.createHash('md5').update('UNKNOWN-FACE-45m').digest('hex')
    }
  ];

  for (const ev of sampleEvents) {
    const devId = dMap[ev.deviceCode];
    const stId = ev.sid ? (sMap[ev.sid] ? sMap[ev.sid].id : null) : null;

    if (devId) {
      await pool.query(
        `INSERT INTO gate_events (event_uuid, device_id, student_id, event_timestamp, direction, verification_type, access_result, denial_reason, event_source, deduplication_hash, processed_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROCESSED')
         ON DUPLICATE KEY UPDATE access_result = VALUES(access_result)`,
        [ev.uuid, devId, stId, ev.time, ev.dir, ev.vtype, ev.result, ev.reason, ev.source, ev.dedup]
      );
    }
  }
  console.log('Sample gate events seeded.');

  // 9. Incidents
  const [existingIncidents] = await pool.query('SELECT id FROM incidents LIMIT 1');
  if (existingIncidents.length === 0) {
    await pool.query(
      `INSERT INTO incidents (incident_type, title, description, student_id, gate_device_id, reported_by_user_id, assigned_to_user_id, severity, status)
       VALUES 
       ('UNAUTHORIZED_ATTEMPT', 'Exit Attempt Without Valid Outing Approval', 'Student attempted gate exit on Lane 1 while outing was still pending warden authorization. Turnstile barrier remained locked.', ?, ?, ?, ?, 'MEDIUM', 'RESOLVED'),
       ('OVERDUE_BREACH', 'Curfew Overdue Alert - Vignesh Chandran', 'Student has exceeded sanctioned return time (5:00 PM). Automatic notification triggered. Warden dispatched SMS to parent.', ?, ?, ?, ?, 'HIGH', 'IN_PROGRESS')`,
      [
        sMap['720721104001'] ? sMap['720721104001'].id : null,
        dMap['TW-TF3000-LANE1'] || null,
        wardenId,
        wardenId,
        sMap['720721102008'] ? sMap['720721102008'].id : null,
        dMap['TW-TF3000-LANE1'] || null,
        wardenId,
        wardenId
      ]
    );
    console.log('Sample incidents seeded.');
  }

  // 10. Audit Logs
  const [existingLogs] = await pool.query('SELECT id FROM audit_logs LIMIT 1');
  if (existingLogs.length === 0) {
    await pool.query(
      `INSERT INTO audit_logs (user_id, actor_name, actor_role, action, entity_type, entity_id, details, ip_address)
       VALUES 
       (?, 'System Initializer', 'SYSTEM', 'DATABASE_SEED', 'SYSTEM', '1', 'Initial database schema and default records seeded successfully.', '127.0.0.1'),
       (?, 'Dr. S. K. Raman', 'WARDEN', 'OUTING_APPROVAL', 'OUTING', '2', 'Approved local outing for Karthik Subramanian (720721104015).', '192.168.1.15')`,
      [wardenId, wardenId]
    );
    console.log('Sample audit logs seeded.');
  }

  console.log('--- SmartGate Database Seeding Completed Successfully! ---\n');
  process.exit(0);
}

seedDatabase().catch(err => {
  console.error('Database Seeding Failed:', err);
  process.exit(1);
});
