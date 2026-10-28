const crypto = require('crypto');
const { pool, withTransaction } = require('../config/database');
const deviceManager = require('./deviceManager');

function toDateStr(d) {
  if (!d) return '';
  if (typeof d === 'string') return d.substring(0, 10);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

class EventProcessor {
  /**
   * Process a normalized gate access event
   * @param {Object} event - Normalized event object
   * @returns {Promise<Object>} Access decision and event details
   */
  async processEvent(event) {
    const {
      eventUuid = crypto.randomUUID(),
      deviceId,
      deviceCode,
      biometricDeviceId,
      cardNumber,
      studentId: directStudentId,
      direction: inputDirection,
      verificationType = 'FACE',
      eventSource = 'SIMULATED',
      timestamp = new Date(),
      skipDedup = false,
      rawPayload = {}
    } = event;

    // 1. Fetch Device Information
    let device = null;
    if (deviceId) {
      const [devRows] = await pool.query('SELECT * FROM gate_devices WHERE id = ?', [deviceId]);
      if (devRows.length > 0) device = devRows[0];
    } else if (deviceCode) {
      const [devRows] = await pool.query('SELECT * FROM gate_devices WHERE device_code = ?', [deviceCode]);
      if (devRows.length > 0) device = devRows[0];
    }

    if (!device) {
      throw new Error(`Gate device not recognized: ${deviceId || deviceCode}`);
    }

    // Prioritize explicit direction; fallback to device's physical turnstile lane direction
    let direction = inputDirection;
    if (!direction || direction === 'UNKNOWN' || direction === 'BIDIRECTIONAL') {
      if (device.lane_direction === 'ENTRY' || device.lane_direction === 'EXIT') {
        direction = device.lane_direction;
      } else {
        direction = 'ENTRY';
      }
    }

    // 2. Check Deduplication Hash (5-second window)
    const timeKey = Math.floor(new Date(timestamp).getTime() / 5000); // 5-sec bucket
    const dedupIdentifier = biometricDeviceId || cardNumber || directStudentId || 'UNKNOWN';
    const dedupHash = crypto
      .createHash('sha256')
      .update(`${device.id}:${dedupIdentifier}:${direction}:${timeKey}`)
      .digest('hex');

    if (!skipDedup) {
      const [recentDedup] = await pool.query(
        'SELECT id, access_result, denial_reason FROM gate_events WHERE deduplication_hash = ? AND created_at >= NOW() - INTERVAL 5 SECOND',
        [dedupHash]
      );

      if (recentDedup.length > 0) {
        return {
          isDuplicate: true,
          message: 'Duplicate event suppressed (within 5s anti-bounce window).',
          previousEventId: recentDedup[0].id,
          accessResult: recentDedup[0].access_result,
          granted: recentDedup[0].access_result === 'GRANTED',
          relayTriggered: false
        };
      }
    }

    // 3. Resolve Student Identity
    let student = null;
    if (biometricDeviceId) {
      const [sRows] = await pool.query(
        'SELECT * FROM students WHERE biometric_device_id = ? LIMIT 1',
        [biometricDeviceId]
      );
      if (sRows.length > 0) student = sRows[0];
    }

    if (!student && cardNumber) {
      const [sRows] = await pool.query(
        'SELECT * FROM students WHERE card_number = ? LIMIT 1',
        [cardNumber]
      );
      if (sRows.length > 0) student = sRows[0];
    }

    if (!student && directStudentId) {
      const [sRows] = await pool.query(
        'SELECT * FROM students WHERE student_id = ? OR id = ? LIMIT 1',
        [directStudentId, directStudentId]
      );
      if (sRows.length > 0) student = sRows[0];
    }

    // Case A: Unregistered Identity
    if (!student) {
      const denialReason = 'Unregistered biometric or unassigned RFID card.';
      await pool.query(
        `INSERT INTO gate_events 
         (event_uuid, device_id, student_id, event_timestamp, direction, verification_type, access_result, denial_reason, event_source, deduplication_hash, raw_payload, processed_status)
         VALUES (?, ?, NULL, ?, ?, ?, 'DENIED', ?, ?, ?, ?, 'PROCESSED')`,
        [eventUuid, device.id, timestamp, direction, verificationType, denialReason, eventSource, dedupHash, JSON.stringify(rawPayload)]
      );

      return {
        granted: false,
        accessResult: 'DENIED',
        denialReason,
        direction,
        verificationType,
        deviceCode: device.device_code,
        student: null,
        outing: null,
        relayTriggered: false
      };
    }

    // Case B: Inactive Student
    if (!student.is_active) {
      const denialReason = 'Student account is deactivated / suspended.';
      await pool.query(
        `INSERT INTO gate_events 
         (event_uuid, device_id, student_id, event_timestamp, direction, verification_type, access_result, denial_reason, event_source, deduplication_hash, raw_payload, processed_status)
         VALUES (?, ?, ?, ?, ?, ?, 'DENIED', ?, ?, ?, ?, 'PROCESSED')`,
        [eventUuid, device.id, student.id, timestamp, direction, verificationType, denialReason, eventSource, dedupHash, JSON.stringify(rawPayload)]
      );

      return {
        granted: false,
        accessResult: 'DENIED',
        denialReason,
        direction,
        verificationType,
        deviceCode: device.device_code,
        student: { id: student.id, student_id: student.student_id, name: `${student.first_name} ${student.last_name}` },
        outing: null,
        relayTriggered: false
      };
    }

    // 4. Evaluate Outings and Movement Direction
    let accessResult = 'GRANTED';
    let denialReason = null;
    let relatedOuting = null;
    let shouldPulseRelay = false;
    let newLocationStatus = student.current_location_status;
    let overdueMinutes = 0;

    const eventDate = toDateStr(timestamp);

    if (direction === 'EXIT') {
      // Check for an APPROVED outing pass
      const [approvedOutings] = await pool.query(
        `SELECT * FROM outings 
         WHERE student_id = ? AND status = 'APPROVED'
         ORDER BY id DESC LIMIT 1`,
        [student.id]
      );

      if (approvedOutings.length === 0) {
        // Check if there is a pending outing
        const [pendingOutings] = await pool.query(
          `SELECT id, status FROM outings WHERE student_id = ? AND status = 'PENDING' LIMIT 1`,
          [student.id]
        );

        accessResult = 'DENIED';
        denialReason = pendingOutings.length > 0
          ? 'Outing request is still PENDING warden approval. Exit denied.'
          : 'No approved outing pass found. Exit denied.';
      } else {
        relatedOuting = approvedOutings[0];
        const outingDeptDate = toDateStr(relatedOuting.departure_date);
        
        // Allowed if approved for today or ongoing
        if (outingDeptDate > eventDate) {
          accessResult = 'DENIED';
          denialReason = `Outing pass is scheduled for future date: ${outingDeptDate}. Early exit denied.`;
        } else {
          accessResult = 'GRANTED';
          shouldPulseRelay = true;
          newLocationStatus = 'OUTSIDE';
        }
      }
    } else {
      // DIRECTION === 'ENTRY' (Student returning to hostel)
      accessResult = 'GRANTED';
      shouldPulseRelay = true;
      newLocationStatus = 'INSIDE';

      // Look for active or approved outing to mark completed
      const [activeOutings] = await pool.query(
        `SELECT * FROM outings 
         WHERE student_id = ? AND status IN ('APPROVED', 'OVERDUE')
         ORDER BY id DESC LIMIT 1`,
        [student.id]
      );

      if (activeOutings.length > 0) {
        relatedOuting = activeOutings[0];
        
        // Check if student is overdue
        const expectedReturnStr = `${new Date(relatedOuting.expected_return_date).toISOString().split('T')[0]}T${relatedOuting.expected_return_time}`;
        const expectedReturnTime = new Date(expectedReturnStr).getTime();
        const currentReturnTime = new Date(timestamp).getTime();

        if (currentReturnTime > expectedReturnTime) {
          overdueMinutes = Math.round((currentReturnTime - expectedReturnTime) / (60 * 1000));
        }
      }
    }

    // 5. Execute State Transitions in a Transaction
    await withTransaction(async (conn) => {
      // Insert Gate Event
      await conn.query(
        `INSERT INTO gate_events 
         (event_uuid, device_id, student_id, event_timestamp, direction, verification_type, access_result, denial_reason, related_outing_id, event_source, deduplication_hash, raw_payload, processed_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROCESSED')`,
        [
          eventUuid,
          device.id,
          student.id,
          timestamp,
          direction,
          verificationType,
          accessResult,
          denialReason,
          relatedOuting ? relatedOuting.id : null,
          eventSource,
          dedupHash,
          JSON.stringify(rawPayload)
        ]
      );

      if (accessResult === 'GRANTED') {
        // Update Student location
        await conn.query(
          'UPDATE students SET current_location_status = ?, updated_at = NOW() WHERE id = ?',
          [newLocationStatus, student.id]
        );

        // Update Outing if linked
        if (relatedOuting) {
          if (direction === 'EXIT') {
            await conn.query(
              'UPDATE outings SET actual_departure_time = NOW(), updated_at = NOW() WHERE id = ?',
              [relatedOuting.id]
            );
          } else if (direction === 'ENTRY') {
            const completionRemarks = overdueMinutes > 0
              ? `Returned with ${overdueMinutes} mins delay.`
              : 'Returned on time.';

            await conn.query(
              `UPDATE outings 
               SET actual_return_time = NOW(), 
                   status = 'COMPLETED',
                   approval_remarks = CONCAT(IFNULL(approval_remarks, ''), ' [Gate Return: ', ?, ']')
               WHERE id = ?`,
              [completionRemarks, relatedOuting.id]
            );

            // If significantly overdue (> 15 mins), create an incident log
            if (overdueMinutes > 15) {
              await conn.query(
                `INSERT INTO incidents 
                 (incident_type, title, description, student_id, gate_device_id, reported_by_user_id, severity, status)
                 VALUES ('OVERDUE_BREACH', ?, ?, ?, ?, (SELECT id FROM users WHERE role = 'SUPER_ADMIN' LIMIT 1), 'MEDIUM', 'OPEN')`,
                [
                  `Curfew Delay: ${student.first_name} ${student.last_name} (${overdueMinutes}m late)`,
                  `Student returned to hostel ${overdueMinutes} minutes after approved curfew deadline (${relatedOuting.expected_return_time}). Outing ID #${relatedOuting.id}.`,
                  student.id,
                  device.id
                ]
              );
            }
          }
        }
      }
    });

    // 6. Trigger Physical Turnstile Relay if Granted
    let relayResponse = null;
    if (shouldPulseRelay) {
      try {
        relayResponse = await deviceManager.triggerRelay(device.id, device.turnstile_unlock_duration_ms || 10000);
      } catch (relayErr) {
        console.error(`Relay pulse error on device ${device.device_code}:`, relayErr.message);
      }
    }

    return {
      granted: accessResult === 'GRANTED',
      accessResult,
      denialReason,
      direction,
      verificationType,
      deviceCode: device.device_code,
      deviceName: device.device_name,
      student: {
        id: student.id,
        student_id: student.student_id,
        name: `${student.first_name} ${student.last_name}`,
        department: student.department,
        newLocationStatus
      },
      outing: relatedOuting ? { id: relatedOuting.id, type: relatedOuting.outing_type, status: relatedOuting.status } : null,
      relayTriggered: shouldPulseRelay,
      relayResponse,
      overdueMinutes
    };
  }
}

module.exports = new EventProcessor();
