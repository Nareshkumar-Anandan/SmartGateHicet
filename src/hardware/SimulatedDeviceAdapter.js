const DeviceAdapterInterface = require('./DeviceAdapterInterface');

class SimulatedDeviceAdapter extends DeviceAdapterInterface {
  constructor(deviceConfig) {
    super(deviceConfig);
    this.isOnline = deviceConfig.status !== 'OFFLINE';
    this.lastRelayTrigger = null;
    this.firmware = deviceConfig.firmware_version || 'SIM-v1.0.0-HICET';
  }

  async connect() {
    this.isOnline = true;
    return true;
  }

  async disconnect() {
    this.isOnline = false;
    return true;
  }

  async getStatus() {
    return {
      online: this.isOnline,
      ip: this.deviceConfig.ip_address,
      port: this.deviceConfig.port,
      serialNumber: this.deviceConfig.serial_number,
      model: this.deviceConfig.model,
      firmware: this.firmware,
      lastHeartbeat: new Date(),
      lastRelayTrigger: this.lastRelayTrigger,
      simulated: true
    };
  }

  async triggerTurnstileRelay(durationMs = 3000) {
    if (!this.isOnline) {
      throw new Error(`Device ${this.deviceConfig.device_code} is offline. Cannot trigger turnstile barrier.`);
    }

    this.lastRelayTrigger = {
      timestamp: new Date(),
      durationMs,
      relayPin: this.deviceConfig.turnstile_relay_pin || 1
    };

    console.log(`[SIMULATED RELAY] ${this.deviceConfig.device_name} (Relay Pin ${this.lastRelayTrigger.relayPin}) unlocked for ${durationMs}ms`);

    return {
      success: true,
      relayPin: this.deviceConfig.turnstile_relay_pin || 1,
      durationMs,
      message: `[SIMULATED] Turnstile solenoid released for ${durationMs / 1000}s. Pedestrian passage permitted.`
    };
  }

  async syncStudent(studentData) {
    return {
      success: true,
      userId: studentData.biometric_device_id || `TW-UID-${studentData.id}`,
      simulated: true,
      message: `Student ${studentData.first_name} ${studentData.last_name} synced to simulated device ${this.deviceConfig.device_code}`
    };
  }

  async deleteStudent(biometricDeviceId) {
    return {
      success: true,
      userId: biometricDeviceId,
      simulated: true,
      message: `User ${biometricDeviceId} removed from simulated device ${this.deviceConfig.device_code}`
    };
  }

  normalizeEvent(rawEvent) {
    return {
      eventUuid: rawEvent.eventUuid || require('crypto').randomUUID(),
      deviceId: this.deviceConfig.id,
      deviceCode: this.deviceConfig.device_code,
      studentId: rawEvent.studentId || null,
      biometricDeviceId: rawEvent.biometricDeviceId || null,
      cardNumber: rawEvent.cardNumber || null,
      timestamp: rawEvent.timestamp ? new Date(rawEvent.timestamp) : new Date(),
      direction: rawEvent.direction || this.deviceConfig.lane_direction || 'ENTRY',
      verificationType: rawEvent.verificationType || 'FACE',
      eventSource: 'SIMULATED',
      rawPayload: rawEvent
    };
  }
}

module.exports = SimulatedDeviceAdapter;
