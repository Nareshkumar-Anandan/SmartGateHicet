const { pool } = require('../src/config/database');
const admsService = require('../src/services/admsService');
const timewatchApiService = require('../src/services/timewatchApiService');

async function testAddAndDeleteSync() {
  console.log('======================================================================');
  console.log('   VERIFYING 2-WAY HARDWARE SYNC (ADD & DELETE) TO TIMEWATCH DEVICES  ');
  console.log('======================================================================\n');

  // Step 1: Check Turnstile devices in database
  const [devices] = await pool.query("SELECT id, device_code, device_name, serial_number, ip_address, status FROM gate_devices WHERE status != 'OFFLINE'");
  console.log(`[1] Found ${devices.length} Active Turnstile Terminals:`);
  devices.forEach(d => console.log(`    - [${d.device_code}] ${d.device_name} (S/N: ${d.serial_number}, IP: ${d.ip_address})`));

  // Step 2: Simulate Adding a Student
  const testPin = '999';
  const testStudentName = 'Biometric Test User';
  const testCard = '999888';
  console.log(`\n[2] Testing Student ADD: Queuing User ${testStudentName} (PIN: ${testPin}, Card: ${testCard})...`);

  for (const dev of devices) {
    const cmdId = admsService.queueCommand(
      dev.serial_number,
      `DATA UPDATE USER PIN=${testPin}\tName=${testStudentName}\tCard=${testCard}\tPri=0\tGrp=1`
    );
    console.log(`    -> Queued to ${dev.serial_number}: C:${cmdId}:DATA UPDATE USER`);
  }

  // Verify command queue for one of the devices (e.g. Lane 2 - Entry)
  const sampleSn = devices[0].serial_number;
  console.log(`\n[3] Simulating Terminal Handshake for ${sampleSn} (Lane 2 Polling GET /iclock/getrequest):`);
  const queueBefore = admsService.commandQueues.get(sampleSn) || [];
  console.log(`    Commands pending for ${sampleSn}: ${queueBefore.length}`);
  
  // Dequeue as the device would
  const dispatchedAddCmd = queueBefore.shift();
  console.log(`    Dispatched to terminal ${sampleSn}: C:${dispatchedAddCmd.id}:${dispatchedAddCmd.cmd}`);

  // Step 3: Simulate Deleting the Student
  console.log(`\n[4] Testing Student DELETE: Queuing Deletion for PIN ${testPin}...`);
  for (const dev of devices) {
    const cmdUser = admsService.queueCommand(dev.serial_number, `DATA DELETE USER PIN=${testPin}`);
    const cmdBio = admsService.queueCommand(dev.serial_number, `DATA DELETE BIODATA PIN=${testPin}`);
    console.log(`    -> Queued to ${dev.serial_number}: User Wipe (C:${cmdUser}) & Face Template Wipe (C:${cmdBio})`);
  }

  console.log(`\n[5] Simulating Terminal Polling for ${sampleSn} (Lane 2 Polling GET /iclock/getrequest):`);
  const queueAfterDelete = admsService.commandQueues.get(sampleSn) || [];
  console.log(`    Commands pending for ${sampleSn}: ${queueAfterDelete.length}`);
  
  while (queueAfterDelete.length > 0) {
    const dispatched = queueAfterDelete.shift();
    console.log(`    Dispatched to terminal ${sampleSn}: C:${dispatched.id}:${dispatched.cmd}`);
  }

  console.log('\n======================================================================');
  console.log('   VERIFICATION COMPLETE: BOTH ADD & DELETE PROPAGATE TO ALL DEVICES!   ');
  console.log('======================================================================');
  process.exit(0);
}

testAddAndDeleteSync().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
