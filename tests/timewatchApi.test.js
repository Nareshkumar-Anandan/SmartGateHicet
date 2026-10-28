const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const test = require('node:test');
const assert = require('node:assert/strict');
const timewatchApiService = require('../src/services/timewatchApiService');
const timewatchSyncService = require('../src/services/timewatchSyncService');
const { pool } = require('../src/config/database');

test('TimeWatch API & Sync Services Test Suite', async (t) => {
  await t.test('1. TimeWatch API Client Configuration & Defaults', () => {
    const config = timewatchApiService.getConfig();
    assert.ok(config.apiUrl, 'API URL should be configured');
    assert.ok(config.apiUrl.includes('TimeWatchAPI'), 'API URL should point to TimeWatchAPI');
    assert.ok(config.apiKeyMasked, 'API Key should be masked');
    assert.equal(typeof config.timeoutMs, 'number', 'Timeout should be numeric');
  });

  await t.test('2. Parameter Validation for Mandatory Fields across TWAPI Endpoints', async () => {
    // 2.1 getUserDetail: requires UserID or DeviceID
    await assert.rejects(
      async () => await timewatchApiService.getUserDetail({}),
      /At least one parameter/
    );

    // 2.2 addUser: requires UserID, Name, DeviceID
    await assert.rejects(
      async () => await timewatchApiService.addUser({ UserID: '123' }),
      /UserID, Name, and DeviceID are mandatory/
    );

    // 2.3 deleteUser: requires UserID and DeviceID
    await assert.rejects(
      async () => await timewatchApiService.deleteUser({ UserID: '123' }),
      /Both UserID and DeviceID are mandatory/
    );

    // 2.4 getPunchData: requires FromDate and ToDate
    await assert.rejects(
      async () => await timewatchApiService.getPunchData({}),
      /FromDate and ToDate are required/
    );

    // 2.5 getUserImage: requires DeviceID and UserID
    await assert.rejects(
      async () => await timewatchApiService.getUserImage({}),
      /Both DeviceID and UserID are mandatory/
    );

    // 2.6 syncTime: requires non-empty DeviceList
    await assert.rejects(
      async () => await timewatchApiService.syncTime([]),
      /DeviceList array must contain at least one valid serial number/
    );

    // 2.7 pullLogs: requires non-empty DeviceList
    await assert.rejects(
      async () => await timewatchApiService.pullLogs({ DeviceList: [] }),
      /DeviceList array must contain at least one valid serial number/
    );

    // 2.8 remoteEnrollment: requires valid type
    await assert.rejects(
      async () => await timewatchApiService.remoteEnrollment({ DeviceID: 'TW1', UserID: '123', Type: 'INVALID' }),
      /Invalid Type/
    );
  });

  await t.test('3. Verify Mode & Direction Normalization in Sync Service', () => {
    assert.equal(timewatchSyncService.normalizeVerifyType('15'), 'FACE');
    assert.equal(timewatchSyncService.normalizeVerifyType('FACE'), 'FACE');
    assert.equal(timewatchSyncService.normalizeVerifyType('4'), 'CARD');
    assert.equal(timewatchSyncService.normalizeVerifyType('CARD'), 'CARD');
    assert.equal(timewatchSyncService.normalizeVerifyType('1'), 'FP');
    assert.equal(timewatchSyncService.normalizeVerifyType('0'), 'PASSWORD');
    assert.equal(timewatchSyncService.normalizeVerifyType('20'), 'QR');

    assert.equal(timewatchSyncService.normalizeDirection('0', 'ENTRY'), 'ENTRY');
    assert.equal(timewatchSyncService.normalizeDirection('1', 'ENTRY'), 'EXIT');
    assert.equal(timewatchSyncService.normalizeDirection('ENTRY', 'ENTRY'), 'ENTRY');
    assert.equal(timewatchSyncService.normalizeDirection('EXIT', 'ENTRY'), 'EXIT');
    assert.equal(timewatchSyncService.normalizeDirection(null, 'EXIT'), 'EXIT');
  });

  await t.test('4. Safe Network Handling / Timeout on Unreachable Hardware', async () => {
    // Test with dummy unreachable host to verify timeout/error handling doesn't crash server
    const testClient = new (timewatchApiService.constructor)();
    testClient.updateConfig({
      apiUrl: 'http://127.0.0.1:59999/TimeWatchAPI',
      timeoutMs: 800
    });

    const connTest = await testClient.testConnection();
    assert.equal(connTest.connected, false, 'Should gracefully return connected: false');
    assert.ok(connTest.details.error, 'Should capture error or timeout status');
  });

  await t.test('5. Two-Way Sync: SmartGate -> Terminal (AddUser & GetUserDetail)', async () => {
    // Ensure local bridge server is running
    const twapiServerService = require('../src/services/twapiServerService');
    twapiServerService.start();

    timewatchApiService.updateConfig({
      apiUrl: 'http://127.0.0.1:8001/TimeWatchAPI',
      timeoutMs: 3000
    });

    const testSn = 'TW30000000260207';
    const testUserId = `TW-TEST-${Date.now()}`;
    const testName = 'Priya Sharma';

    // 5.1 Push student to terminal via AddUser
    const addRes = await timewatchApiService.addUser({
      UserID: testUserId,
      Name: testName,
      DeviceID: testSn,
      Card: '77889900'
    });
    assert.equal(addRes.success, true, 'AddUser should succeed');
    assert.equal(addRes.data.UserID, testUserId);

    // 5.2 Query user details back from terminal via GetUserDetail
    const getRes = await timewatchApiService.getUserDetail({
      UserID: testUserId,
      DeviceID: testSn
    });
    assert.equal(getRes.success, true, 'GetUserDetail should find enrolled student');
    assert.equal(getRes.data.Name, testName);
  });

  await t.test('6. Two-Way Sync: Terminal -> SmartGate (Import Terminal Users)', async () => {
    const testSn = 'TW30000000260207';
    const machineUserId = `MCH_${Date.now()}`;

    // Enroll user on terminal via TWAPI AddUser
    const enrollRes = await timewatchApiService.addUser({
      UserID: machineUserId,
      Name: 'Terminal Enrolled Student',
      DeviceID: testSn,
      Card: '11223344'
    });
    assert.equal(enrollRes.success, true);

    // Run terminal user sync to import machine user into SmartGate database
    const syncRes = await timewatchSyncService.syncTerminalUsersToDatabase(testSn);
    assert.equal(syncRes.success, true);
    assert.ok(syncRes.importedCount >= 1, 'Should import newly discovered machine user');

    // Verify student is now present in MySQL students table
    const [rows] = await pool.query(
      'SELECT id, first_name, last_name, biometric_device_id FROM students WHERE biometric_device_id = ?',
      [machineUserId]
    );
    assert.equal(rows.length, 1, 'Imported student must exist in database');
    assert.equal(rows[0].biometric_device_id, machineUserId);

    // Clean up
    await pool.query('DELETE FROM students WHERE biometric_device_id = ?', [machineUserId]);
  });

  await t.test('7. Auto-Enrollment on Terminal Punch (Unknown Biometric ID punches)', async () => {
    const unknownPin = `PNCH_${Date.now()}`;

    // Student does not exist in DB yet
    const [before] = await pool.query('SELECT id FROM students WHERE biometric_device_id = ?', [unknownPin]);
    assert.equal(before.length, 0);

    // Terminal punch arrives -> auto-enroll trigger
    const newStudentId = await timewatchSyncService.autoEnrollTerminalUser(
      unknownPin,
      'TW30000000260207',
      { Name: 'Arun Kumar', Card: '55667788' }
    );
    assert.ok(newStudentId, 'Should return created student insert ID');

    // Verify student profile was automatically created in SmartGate
    const [after] = await pool.query('SELECT * FROM students WHERE id = ?', [newStudentId]);
    assert.equal(after.length, 1);
    assert.equal(after[0].first_name, 'Arun');
    assert.equal(after[0].last_name, 'Kumar');
    assert.equal(after[0].biometric_device_id, unknownPin);
    assert.equal(after[0].card_number, '55667788');
    assert.equal(after[0].is_active, 1);

    // Clean up
    await pool.query('DELETE FROM students WHERE id = ?', [newStudentId]);
  });

  t.after(async () => {
    const twapiServerService = require('../src/services/twapiServerService');
    twapiServerService.stop();
    await pool.end();
  });
});
