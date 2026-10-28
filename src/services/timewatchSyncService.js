const crypto = require('crypto');
const { pool } = require('../config/database');
const timewatchApiService = require('./timewatchApiService');
const eventProcessor = require('./eventProcessor');

class TimeWatchSyncService {
  /**
   * Normalize verify mode from numeric code or string
   */
  normalizeVerifyType(rawMode) {
    if (!rawMode) return 'FACE';
    const s = String(rawMode).trim().toUpperCase();
    if (s === '15' || s === 'FACE') return 'FACE';
    if (s === '4' || s === 'CARD' || s === 'RFID') return 'CARD';
    if (s === '1' || s === 'FP' || s === 'FINGERPRINT') return 'FP';
    if (s === '0' || s === 'PASSWORD' || s === 'PWD') return 'PASSWORD';
    if (s === '20' || s === 'QR') return 'QR';
    return 'FACE';
  }

  /**
   * Normalize direction from code or string
   */
  normalizeDirection(rawDir, deviceDirection = 'ENTRY') {
    if (rawDir === undefined || rawDir === null || rawDir === '') {
      return deviceDirection === 'EXIT' ? 'EXIT' : 'ENTRY';
    }
    const s = String(rawDir).trim().toUpperCase();
    if (s === '1' || s === 'EXIT' || s === 'OUT') return 'EXIT';
    if (s === '0' || s === 'ENTRY' || s === 'IN') return 'ENTRY';
    return deviceDirection === 'EXIT' ? 'EXIT' : 'ENTRY';
  }

  /**
   * Pull punches from TimeWatch API and ingest them into SmartGate gate_events
   */
  async syncPunchData({ FromDate, ToDate, DeviceID = '', UserID = '', dryRun = false }) {
    const apiRes = await timewatchApiService.getPunchData({
      FromDate,
      ToDate,
      DeviceID,
      UserID
    });

    if (!apiRes.success) {
      return {
        success: false,
        error: apiRes.error || 'PUNCH_FETCH_FAILED',
        message: apiRes.message || 'Failed to fetch punches from TimeWatch API',
        latencyMs: apiRes.latencyMs,
        details: apiRes
      };
    }

    // Extract records array from various possible wrapper shapes
    let records = [];
    const rawData = apiRes.data;
    if (Array.isArray(rawData)) {
      records = rawData;
    } else if (rawData && typeof rawData === 'object') {
      records = rawData.Data || rawData.data || rawData.PunchData || rawData.records || rawData.result || [];
    }

    if (!Array.isArray(records)) {
      records = [];
    }

    // Cache existing gate devices from DB
    const [devices] = await pool.query('SELECT * FROM gate_devices');
    const deviceMap = new Map();
    devices.forEach(d => {
      deviceMap.set(d.serial_number.toLowerCase(), d);
      deviceMap.set(d.device_code.toLowerCase(), d);
      deviceMap.set(String(d.id), d);
    });
    const defaultDevice = devices[0] || null;

    const summary = {
      totalFound: records.length,
      processed: 0,
      duplicates: 0,
      granted: 0,
      denied: 0,
      errors: 0,
      dryRun,
      results: []
    };

    for (const record of records) {
      try {
        const rawUserId = record.UserID || record.UserId || record.user_id || record.PIN || record.EnrollNumber;
        const rawTime = record.PunchTime || record.LogTime || record.Time || record.VerifyDate || record.timestamp || record.DateTime;
        const rawDevId = record.DeviceID || record.DeviceId || record.device_id || record.SN || record.SerialNumber || DeviceID;
        const rawMode = record.VerifyMode !== undefined ? record.VerifyMode : record.VerifyType || record.Type;
        const rawDir = record.Direction !== undefined ? record.Direction : record.InOut || record.State;

        if (!rawUserId) {
          summary.errors++;
          continue;
        }

        // Match device
        const matchedDevice = (rawDevId && deviceMap.get(String(rawDevId).toLowerCase())) || defaultDevice;
        if (!matchedDevice) {
          summary.errors++;
          summary.results.push({
            userId: rawUserId,
            error: 'No gate device matched in system.'
          });
          continue;
        }

        const verificationType = this.normalizeVerifyType(rawMode);
        const direction = this.normalizeDirection(rawDir, matchedDevice.lane_direction);
        const eventTime = rawTime ? new Date(rawTime) : new Date();

        if (dryRun) {
          summary.processed++;
          summary.results.push({
            userId: rawUserId,
            deviceId: matchedDevice.id,
            deviceCode: matchedDevice.device_code,
            direction,
            verificationType,
            timestamp: eventTime,
            status: 'DRY_RUN'
          });
          continue;
        }

        // Auto-enroll machine user if not yet in database
        if (!dryRun) {
          const cleanBioId = String(rawUserId).trim();
          const [sCheck] = await pool.query(
            'SELECT id FROM students WHERE biometric_device_id = ? OR student_id = ? LIMIT 1',
            [cleanBioId, cleanBioId]
          );

          if (sCheck.length === 0) {
            await this.autoEnrollTerminalUser(cleanBioId, matchedDevice.serial_number, record);
          }
        }

        // Ingest into SmartGate eventProcessor
        const decision = await eventProcessor.processEvent({
          eventUuid: crypto.randomUUID(),
          deviceId: matchedDevice.id,
          deviceCode: matchedDevice.device_code,
          biometricDeviceId: String(rawUserId).trim(),
          timestamp: eventTime,
          direction,
          verificationType,
          eventSource: 'HARDWARE',
          rawPayload: record
        });

        summary.processed++;
        if (decision.isDuplicate) {
          summary.duplicates++;
        } else if (decision.granted) {
          summary.granted++;
        } else {
          summary.denied++;
        }

        summary.results.push({
          userId: rawUserId,
          studentName: decision.student ? `${decision.student.first_name} ${decision.student.last_name}` : 'Unregistered Student',
          accessResult: decision.accessResult,
          denialReason: decision.denialReason || null,
          isDuplicate: !!decision.isDuplicate,
          direction,
          verificationType,
          deviceCode: matchedDevice.device_code,
          timestamp: eventTime
        });
      } catch (procErr) {
        summary.errors++;
        summary.results.push({
          record,
          error: procErr.message
        });
      }
    }

    return {
      success: true,
      apiLatencyMs: apiRes.latencyMs,
      summary
    };
  }

  /**
   * Auto-enrolls a student in SmartGate when an unknown biometric ID punches
   */
  async autoEnrollTerminalUser(rawUserId, deviceId, rawPayload = {}) {
    try {
      const cleanPin = String(rawUserId).trim();
      if (!cleanPin || cleanPin === 'ALL') return null;

      let name = rawPayload.Name || rawPayload.name || '';
      let card = rawPayload.Card || rawPayload.card || null;

      // Try fetching details from terminal if not in punch record
      if (!name) {
        try {
          const uRes = await timewatchApiService.getUserDetail({ UserID: cleanPin, DeviceID: deviceId || '' });
          if (uRes.success && uRes.data) {
            const u = uRes.data;
            if (u.Name && u.Name !== 'Biometric Student' && u.Name !== 'Enrolled User') {
              name = u.Name;
            }
            if (u.Card) card = u.Card;
          }
        } catch {}
      }

      const rawName = name || `Student ${cleanPin}`;
      const nameParts = rawName.split(' ');
      const firstName = nameParts[0] || rawName;
      const lastName = nameParts.slice(1).join(' ') || '(Terminal Enrolled)';
      const studentRoll = `TW-${cleanPin}`;
      const cleanEmail = `stu_${cleanPin.toLowerCase().replace(/[^a-z0-9]/g, '')}@hicet.ac.in`;

      const [res] = await pool.query(
        `INSERT INTO students 
         (student_id, first_name, last_name, department, course, year_of_study, phone, parent_phone, email, current_location_status, biometric_device_id, biometric_enrolled, card_number, is_active)
         VALUES (?, ?, ?, 'Engineering', 'B.E.', 1, '9000000000', '9000000000', ?, 'INSIDE', ?, 1, ?, 1)`,
        [studentRoll, firstName, lastName, cleanEmail, cleanPin, card]
      );

      console.log(`[PUNCH SYNC AUTO-ENROLL] Auto-registered student ${firstName} ${lastName} (${cleanPin}) from terminal punch.`);
      return res.insertId;
    } catch (err) {
      console.warn(`[PUNCH SYNC AUTO-ENROLL WARN] Could not auto-enroll ${rawUserId}:`, err.message);
      return null;
    }
  }

  /**
   * Query terminal and import any newly enrolled users into SmartGate
   */
  async syncTerminalUsersToDatabase(deviceId) {
    const [devices] = await pool.query('SELECT * FROM gate_devices');
    const targetDev = deviceId 
      ? devices.find(d => d.serial_number === deviceId || d.device_code === deviceId || String(d.id) === String(deviceId))
      : devices[0];
    const sn = targetDev ? targetDev.serial_number : (deviceId || devices[0]?.serial_number || 'TW30000000260207');

    const userRes = await timewatchApiService.getUserDetail({ DeviceID: sn });
    let rawList = [];
    if (userRes.success && userRes.data) {
      if (Array.isArray(userRes.data)) rawList = userRes.data;
      else if (Array.isArray(userRes.data.Data)) rawList = userRes.data.Data;
      else if (Array.isArray(userRes.data.data)) rawList = userRes.data.data;
      else if (Array.isArray(userRes.data.UserList)) rawList = userRes.data.UserList;
      else rawList = [userRes.data];
    }

    const imported = [];
    for (const u of rawList) {
      const pin = u.UserID || u.Pin || u.PIN || u.user_id;
      if (!pin || pin === 'ALL') continue;

      const cleanPin = String(pin).trim();
      const [existing] = await pool.query(
        'SELECT id, card_number, biometric_enrolled FROM students WHERE biometric_device_id = ? OR student_id = ? LIMIT 1',
        [cleanPin, cleanPin]
      );

      if (existing.length === 0) {
        const studentRoll = `TW-${cleanPin}`;
        const rawName = u.Name || `Student ${cleanPin}`;
        const nameParts = rawName.trim().split(' ');
        const firstName = nameParts[0] || rawName;
        const lastName = nameParts.slice(1).join(' ') || '(Terminal Enrolled)';
        const card = u.Card ? String(u.Card).trim() : null;

        const [insertRes] = await pool.query(
          `INSERT INTO students 
           (student_id, first_name, last_name, department, course, year_of_study, phone, parent_phone, email, current_location_status, biometric_device_id, biometric_enrolled, card_number, is_active)
           VALUES (?, ?, ?, 'Engineering', 'B.E.', 1, '9000000000', '9000000000', ?, 'INSIDE', ?, 1, ?, 1)`,
          [studentRoll, firstName, lastName, `stu_${cleanPin.toLowerCase().replace(/[^a-z0-9]/g, '')}@hicet.ac.in`, cleanPin, card]
        );

        imported.push({
          id: insertRes.insertId,
          studentId: studentRoll,
          name: `${firstName} ${lastName}`,
          biometricId: cleanPin
        });
      } else {
        // Update biometric enrolled flag if needed
        const student = existing[0];
        if (!student.biometric_enrolled) {
          await pool.query('UPDATE students SET biometric_enrolled = 1 WHERE id = ?', [student.id]);
        }
      }
    }

    return {
      success: true,
      deviceId: sn,
      importedCount: imported.length,
      imported
    };
  }
}

module.exports = new TimeWatchSyncService();
