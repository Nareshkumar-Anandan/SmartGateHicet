const crypto = require('crypto');
const { pool } = require('../config/database');
const eventProcessor = require('../services/eventProcessor');
const deviceManager = require('../services/deviceManager');

async function triggerScan(req, res, next) {
  try {
    const {
      deviceId,
      studentId,
      biometricDeviceId,
      cardNumber,
      direction = 'ENTRY',
      verificationType = 'FACE',
      isUnregistered = false
    } = req.body;

    if (!deviceId) {
      return res.status(400).json({ success: false, message: 'Gate device selection is required.' });
    }

    const adapter = await deviceManager.getAdapter(deviceId);

    let rawEvent = {
      eventUuid: crypto.randomUUID(),
      timestamp: new Date(),
      direction,
      verificationType,
      simulated: true
    };

    if (isUnregistered) {
      rawEvent.biometricDeviceId = 'UNKNOWN-FACE-' + crypto.randomBytes(3).toString('hex');
    } else {
      rawEvent.studentId = studentId || null;
      rawEvent.biometricDeviceId = biometricDeviceId || null;
      rawEvent.cardNumber = cardNumber || null;
    }

    const normalized = adapter.normalizeEvent(rawEvent);
    normalized.eventSource = 'SIMULATED';

    const decision = await eventProcessor.processEvent(normalized);

    return res.json({
      success: true,
      decision
    });
  } catch (error) {
    next(error);
  }
}

async function runScenario(req, res, next) {
  try {
    const { scenarioType, deviceId } = req.body;

    const [[targetDevice]] = await pool.query(
      deviceId 
        ? 'SELECT id, device_code, lane_direction FROM gate_devices WHERE id = ?' 
        : 'SELECT id, device_code, lane_direction FROM gate_devices LIMIT 1',
      deviceId ? [deviceId] : []
    );

    if (!targetDevice) {
      return res.status(404).json({ success: false, message: 'No gate device available for simulation.' });
    }

    const devId = targetDevice.id;

    let scenarioResult = null;

    switch (scenarioType) {
      case 'VALID_EXIT': {
        // Find or create student with approved outing
        const [[student]] = await pool.query(
          `SELECT s.id, s.student_id, s.biometric_device_id, s.first_name, s.last_name
           FROM students s
           JOIN outings o ON o.student_id = s.id
           WHERE o.status = 'APPROVED' AND s.current_location_status = 'INSIDE'
           LIMIT 1`
        );

        if (!student) {
          return res.status(400).json({
            success: false,
            message: 'No student found currently INSIDE with an APPROVED outing pass. Please approve an outing first or use the Outings page.'
          });
        }

        const normalized = {
          eventUuid: crypto.randomUUID(),
          deviceId: devId,
          studentId: student.id,
          biometricDeviceId: student.biometric_device_id,
          direction: 'EXIT',
          verificationType: 'FACE',
          eventSource: 'SIMULATED',
          timestamp: new Date()
        };
        scenarioResult = await eventProcessor.processEvent(normalized);
        break;
      }

      case 'DENIED_EXIT_NO_PASS': {
        // Find a student INSIDE without approved outing
        const [[student]] = await pool.query(
          `SELECT s.id, s.student_id, s.biometric_device_id, s.first_name, s.last_name
           FROM students s
           WHERE s.current_location_status = 'INSIDE'
             AND s.id NOT IN (SELECT student_id FROM outings WHERE status = 'APPROVED')
           LIMIT 1`
        );

        if (!student) {
          return res.status(400).json({ success: false, message: 'No student found without an outing.' });
        }

        const normalized = {
          eventUuid: crypto.randomUUID(),
          deviceId: devId,
          studentId: student.id,
          biometricDeviceId: student.biometric_device_id,
          direction: 'EXIT',
          verificationType: 'FACE',
          eventSource: 'SIMULATED',
          timestamp: new Date()
        };
        scenarioResult = await eventProcessor.processEvent(normalized);
        break;
      }

      case 'VALID_RETURN_ON_TIME': {
        // Student currently outside with approved outing
        const [[student]] = await pool.query(
          `SELECT s.id, s.student_id, s.biometric_device_id, s.first_name, s.last_name
           FROM students s
           WHERE s.current_location_status = 'OUTSIDE'
           LIMIT 1`
        );

        const targetStudent = student || (await pool.query('SELECT * FROM students LIMIT 1'))[0][0];

        const normalized = {
          eventUuid: crypto.randomUUID(),
          deviceId: devId,
          studentId: targetStudent.id,
          biometricDeviceId: targetStudent.biometric_device_id,
          direction: 'ENTRY',
          verificationType: 'FACE',
          eventSource: 'SIMULATED',
          timestamp: new Date()
        };
        scenarioResult = await eventProcessor.processEvent(normalized);
        break;
      }

      case 'UNREGISTERED_FACE': {
        const normalized = {
          eventUuid: crypto.randomUUID(),
          deviceId: devId,
          biometricDeviceId: 'TW-UNKNOWN-' + crypto.randomBytes(3).toString('hex'),
          direction: 'ENTRY',
          verificationType: 'FACE',
          eventSource: 'SIMULATED',
          timestamp: new Date()
        };
        scenarioResult = await eventProcessor.processEvent(normalized);
        break;
      }

      case 'RFID_CARD_ENTRY': {
        const [[student]] = await pool.query('SELECT * FROM students WHERE card_number IS NOT NULL LIMIT 1');
        const normalized = {
          eventUuid: crypto.randomUUID(),
          deviceId: devId,
          studentId: student ? student.id : null,
          cardNumber: student ? student.card_number : 'CRD-DEMO-99',
          direction: 'ENTRY',
          verificationType: 'CARD',
          eventSource: 'SIMULATED',
          timestamp: new Date()
        };
        scenarioResult = await eventProcessor.processEvent(normalized);
        break;
      }

      default:
        return res.status(400).json({ success: false, message: `Unknown scenario type: ${scenarioType}` });
    }

    return res.json({
      success: true,
      scenario: scenarioType,
      decision: scenarioResult
    });
  } catch (error) {
    next(error);
  }
}

async function toggleDeviceState(req, res, next) {
  try {
    const { deviceId, status } = req.body;
    const newStatus = status || 'ONLINE';
    await pool.query(
      'UPDATE gate_devices SET status = ?, last_heartbeat = IF(? = "ONLINE", NOW(), last_heartbeat), updated_at = NOW() WHERE id = ?',
      [newStatus, newStatus, deviceId]
    );
    return res.json({ success: true, message: `Device status toggled to ${newStatus}.` });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  triggerScan,
  runScenario,
  toggleDeviceState
};
