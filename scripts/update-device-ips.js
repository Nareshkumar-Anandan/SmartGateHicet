const { pool } = require('../src/config/database');

async function updateDb() {
  try {
    // 1. Alter table default
    await pool.query("ALTER TABLE gate_devices MODIFY COLUMN ip_address VARCHAR(45) NOT NULL DEFAULT '172.25.26.241'");
    await pool.query("ALTER TABLE gate_devices MODIFY COLUMN lane_direction ENUM('ENTRY', 'EXIT', 'BIDIRECTIONAL') NOT NULL DEFAULT 'ENTRY'");

    // 2. Clean up redundant device id=2 if it exists
    await pool.query("DELETE FROM gate_devices WHERE id = 2 AND NOT EXISTS (SELECT 1 FROM gate_events WHERE device_id = 2)");

    // 3. Update Device id=1 to be Lane 1 (Admin Exit)
    await pool.query(`
      UPDATE gate_devices 
      SET device_code = 'TW-TF3000-LANE1',
          device_name = 'Hostel Main Gate - Lane 1 (Admin Exit)',
          location_description = 'Main Hostel Arch Gate - Lane 1 Admin Exit Turnstile',
          ip_address = '172.25.26.241',
          serial_number = 'TW30000006260161',
          lane_direction = 'EXIT',
          status = 'ONLINE',
          integration_mode = 'HARDWARE_API'
      WHERE id = 1
    `);

    // 4. Upsert all 8 alternating lanes:
    // Lane 1: EXIT (Admin)
    // Lane 2: ENTRY
    // Lane 3: EXIT
    // Lane 4: ENTRY
    // Lane 5: EXIT
    // Lane 6: ENTRY
    // Lane 7: EXIT
    // Lane 8: ENTRY
    const lanes = [
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

    // Remove legacy block names if they have no events attached
    await pool.query(`
      DELETE FROM gate_devices 
      WHERE device_code IN ('TW-TF3000-KBH-A', 'TW-TF3000-BGH-B', 'TW-TF3000-REB-C', 'TW-TF3000-MESS')
        AND id NOT IN (SELECT DISTINCT device_id FROM gate_events)
    `);

    for (const d of lanes) {
      await pool.query(`
        INSERT INTO gate_devices 
        (device_code, device_name, manufacturer, model, serial_number, ip_address, port, mac_address, location_description, lane_direction, turnstile_relay_pin, status, last_heartbeat, integration_mode)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ONLINE', NOW(), 'HARDWARE_API')
        ON DUPLICATE KEY UPDATE 
          device_name = VALUES(device_name), 
          serial_number = VALUES(serial_number),
          ip_address = VALUES(ip_address), 
          lane_direction = VALUES(lane_direction),
          location_description = VALUES(location_description),
          status = VALUES(status)
      `, [d.code, d.name, d.mfg, d.model, d.sn, d.ip, d.port, d.mac, d.loc, d.dir, d.pin]);
    }

    const [rows] = await pool.query('SELECT id, device_code, device_name, serial_number, ip_address, lane_direction, status FROM gate_devices ORDER BY id ASC');
    console.log('--- Configured Turnstile Lanes (Alternating Exit/Entry with Lane 1 Admin Exit) ---');
    console.table(rows);
  } catch (err) {
    console.error('Error configuring lane directions:', err);
  } finally {
    process.exit(0);
  }
}

updateDb();
