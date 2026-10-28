const { pool } = require('../config/database');
const SimulatedDeviceAdapter = require('../hardware/SimulatedDeviceAdapter');
const TimeWatchTrueFace3000Adapter = require('../hardware/TimeWatchTrueFace3000Adapter');

class DeviceManager {
  constructor() {
    this.adapters = new Map();
  }

  async getAdapter(deviceIdOrCode) {
    let deviceRow = null;

    if (typeof deviceIdOrCode === 'number' || !isNaN(Number(deviceIdOrCode))) {
      const [rows] = await pool.query('SELECT * FROM gate_devices WHERE id = ?', [Number(deviceIdOrCode)]);
      if (rows.length > 0) deviceRow = rows[0];
    } else {
      const [rows] = await pool.query(
        'SELECT * FROM gate_devices WHERE device_code = ? OR serial_number = ? OR serial_number LIKE ?',
        [deviceIdOrCode, deviceIdOrCode, `%${String(deviceIdOrCode).replace(/TW30000+/i, '')}%`]
      );
      if (rows.length > 0) deviceRow = rows[0];
    }

    if (!deviceRow) {
      throw new Error(`Device '${deviceIdOrCode}' not found in database.`);
    }

    const cacheKey = `DEV_${deviceRow.id}`;
    if (this.adapters.has(cacheKey)) {
      const adapter = this.adapters.get(cacheKey);
      adapter.deviceConfig = deviceRow; // Refresh config
      return adapter;
    }

    let adapter = null;
    if (deviceRow.manufacturer === 'TimeWatch' && deviceRow.model.includes('TrueFace3000')) {
      adapter = new TimeWatchTrueFace3000Adapter(deviceRow);
    } else {
      adapter = new SimulatedDeviceAdapter(deviceRow);
    }

    this.adapters.set(cacheKey, adapter);
    return adapter;
  }

  async triggerRelay(deviceIdOrCode, durationMs = 3000) {
    const adapter = await this.getAdapter(deviceIdOrCode);
    return await adapter.triggerTurnstileRelay(durationMs);
  }

  async syncStudentToAllDevices(student) {
    const [devices] = await pool.query("SELECT * FROM gate_devices WHERE status != 'OFFLINE'");
    const results = [];
    for (const d of devices) {
      try {
        const adapter = await this.getAdapter(d.id);
        const res = await adapter.syncStudent(student);
        results.push({ deviceCode: d.device_code, success: true, result: res });
      } catch (err) {
        results.push({ deviceCode: d.device_code, success: false, error: err.message });
      }
    }
    return results;
  }
}

module.exports = new DeviceManager();
