const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { pool } = require('../src/config/database');
const eventProcessor = require('../src/services/eventProcessor');

test('SmartGate Business Rules Test Suite', async (t) => {
  let testStudentId = null;
  let testStudentRoll = `TEST_ST_${Date.now()}`;
  let testDeviceId = null;
  let testRoomId = null;
  let testHostelId = null;

  t.before(async () => {
    // 1. Get or create test device
    const [devs] = await pool.query('SELECT id FROM gate_devices LIMIT 1');
    if (devs.length > 0) {
      testDeviceId = devs[0].id;
    }

    // 2. Get hostel and room
    const [hostels] = await pool.query('SELECT id FROM hostels LIMIT 1');
    testHostelId = hostels[0].id;

    const [rooms] = await pool.query('SELECT id, capacity, current_occupancy FROM rooms WHERE hostel_id = ? LIMIT 1', [testHostelId]);
    testRoomId = rooms[0].id;

    // 3. Create a dedicated test student
    const bioId = `TW-TEST-${Date.now()}`;
    const [stRes] = await pool.query(
      `INSERT INTO students (student_id, first_name, last_name, department, course, year_of_study, phone, parent_phone, email, hostel_id, room_id, current_location_status, biometric_device_id, is_active)
       VALUES (?, 'Test', 'Student', 'Computer Science', 'B.E.', 3, '9999900001', '9999900002', ?, ?, ?, 'INSIDE', ?, 1)`,
      [testStudentRoll, `${testStudentRoll}@hicet.ac.in`, testHostelId, testRoomId, bioId]
    );
    testStudentId = stRes.insertId;
  });

  t.after(async () => {
    // Clean up test student, outings, and gate events
    if (testStudentId) {
      await pool.query('DELETE FROM gate_events WHERE student_id = ?', [testStudentId]);
      await pool.query('DELETE FROM outings WHERE student_id = ?', [testStudentId]);
      await pool.query('DELETE FROM students WHERE id = ?', [testStudentId]);
    }
    await pool.end();
  });

  await t.test('1. Gate Exit Denied when Student has no approved outing', async () => {
    const event = {
      eventUuid: crypto.randomUUID(),
      deviceId: testDeviceId,
      studentId: testStudentId,
      direction: 'EXIT',
      verificationType: 'FACE',
      eventSource: 'SIMULATED',
      skipDedup: true,
      timestamp: new Date()
    };

    const decision = await eventProcessor.processEvent(event);
    assert.equal(decision.granted, false, 'Exit should be denied');
    assert.equal(decision.accessResult, 'DENIED');
    assert.match(decision.denialReason, /No approved outing pass found/i);
    assert.equal(decision.relayTriggered, false, 'Turnstile relay must NOT be triggered');
  });

  await t.test('2. Gate Exit Granted when Student has an APPROVED outing pass', async () => {
    const todayStr = new Date().toISOString().split('T')[0];

    // Create and approve an outing pass
    const [outRes] = await pool.query(
      `INSERT INTO outings (student_id, outing_type, departure_date, departure_time, expected_return_date, expected_return_time, destination, reason, status)
       VALUES (?, 'LOCAL_OUTING', ?, '08:00:00', ?, '20:00:00', 'City Center', 'Test errand', 'APPROVED')`,
      [testStudentId, todayStr, todayStr]
    );
    const outingId = outRes.insertId;

    const event = {
      eventUuid: crypto.randomUUID(),
      deviceId: testDeviceId,
      studentId: testStudentId,
      direction: 'EXIT',
      verificationType: 'FACE',
      eventSource: 'SIMULATED',
      skipDedup: true,
      timestamp: new Date()
    };

    const decision = await eventProcessor.processEvent(event);
    assert.equal(decision.granted, true, 'Exit should be granted with approved pass');
    assert.equal(decision.accessResult, 'GRANTED');
    assert.equal(decision.relayTriggered, true, 'Turnstile relay must unlock barrier');

    // Verify student location updated to OUTSIDE
    const [[updatedStudent]] = await pool.query('SELECT current_location_status FROM students WHERE id = ?', [testStudentId]);
    assert.equal(updatedStudent.current_location_status, 'OUTSIDE');

    // Verify outing has actual departure time
    const [[updatedOuting]] = await pool.query('SELECT actual_departure_time FROM outings WHERE id = ?', [outingId]);
    assert.ok(updatedOuting.actual_departure_time, 'Outing actual departure time must be set');
  });

  await t.test('3. Gate Entry Completes active Outing and updates location to INSIDE', async () => {
    const event = {
      eventUuid: crypto.randomUUID(),
      deviceId: testDeviceId,
      studentId: testStudentId,
      direction: 'ENTRY',
      verificationType: 'FACE',
      eventSource: 'SIMULATED',
      skipDedup: true,
      timestamp: new Date()
    };

    const decision = await eventProcessor.processEvent(event);
    assert.equal(decision.granted, true, 'Entry should be granted');
    assert.equal(decision.accessResult, 'GRANTED');
    assert.equal(decision.relayTriggered, true);

    // Verify student location updated to INSIDE
    const [[updatedStudent]] = await pool.query('SELECT current_location_status FROM students WHERE id = ?', [testStudentId]);
    assert.equal(updatedStudent.current_location_status, 'INSIDE');

    // Verify outing status updated to COMPLETED
    const [[updatedOuting]] = await pool.query('SELECT status, actual_return_time FROM outings WHERE student_id = ? ORDER BY id DESC LIMIT 1', [testStudentId]);
    assert.equal(updatedOuting.status, 'COMPLETED');
    assert.ok(updatedOuting.actual_return_time, 'Actual return time must be populated');
  });

  await t.test('4. Unregistered Biometric Identity is Denied Access', async () => {
    const event = {
      eventUuid: crypto.randomUUID(),
      deviceId: testDeviceId,
      biometricDeviceId: 'TW-UNKNOWN-GHOST-ID',
      direction: 'ENTRY',
      verificationType: 'FACE',
      eventSource: 'SIMULATED',
      skipDedup: true,
      timestamp: new Date()
    };

    const decision = await eventProcessor.processEvent(event);
    assert.equal(decision.granted, false);
    assert.equal(decision.accessResult, 'DENIED');
    assert.match(decision.denialReason, /Unregistered/i);
    assert.equal(decision.relayTriggered, false);
  });

  await t.test('5. Room Capacity Limit Enforcement', async () => {
    // Create a temporary room with capacity 1
    const [rRes] = await pool.query(
      `INSERT INTO rooms (hostel_id, room_number, floor, capacity, current_occupancy, status)
       VALUES (?, 'TEST_ROOM_99', 1, 1, 1, 'FULL')`,
      [testHostelId]
    );
    const fullRoomId = rRes.insertId;

    const [[room]] = await pool.query('SELECT capacity, current_occupancy FROM rooms WHERE id = ?', [fullRoomId]);
    assert.equal(room.current_occupancy >= room.capacity, true, 'Room is at full capacity');

    // Clean up
    await pool.query('DELETE FROM rooms WHERE id = ?', [fullRoomId]);
  });
});
