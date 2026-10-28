const { pool } = require('../src/config/database');

async function seedPhysicalDevice() {
  try {
    const [existing] = await pool.query("SELECT * FROM gate_devices WHERE device_code = 'TW-TF3000-MAIN' OR serial_number LIKE '%26207%'");
    
    if (existing.length === 0) {
      await pool.query(`
        INSERT INTO gate_devices 
        (device_code, device_name, manufacturer, model, serial_number, ip_address, port, location_description, lane_direction, status, integration_mode, turnstile_relay_pin, turnstile_unlock_duration_ms, last_heartbeat)
        VALUES 
        ('TW-TF3000-MAIN', 'Hostel Main Gate - Turnstile 1 (TimeWatch TrueFace3000)', 'TimeWatch', 'TrueFace3000 (ADPM)', 'TW3000000026207', '172.25.26.241', 8080, 'Hostel Main Arch - Primary Turnstile Lane', 'BIDIRECTIONAL', 'ONLINE', 'HARDWARE_API', 1, 3000, NOW())
      `);
      console.log('Inserted TimeWatch TrueFace3000 device.');
    } else {
      await pool.query(`
        UPDATE gate_devices 
        SET status = 'ONLINE', integration_mode = 'HARDWARE_API', serial_number = 'TW3000000026207'
        WHERE id = ?
      `, [existing[0].id]);
      console.log('Updated existing gate device.');
    }

    const [devices] = await pool.query('SELECT id, device_code, device_name, serial_number, ip_address, status, integration_mode FROM gate_devices');
    console.log('Current Gate Devices in DB:', devices);
  } catch (err) {
    console.error('Error inserting device:', err);
  } finally {
    process.exit(0);
  }
}

seedPhysicalDevice();
