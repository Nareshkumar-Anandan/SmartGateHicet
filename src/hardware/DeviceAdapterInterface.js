/**
 * DeviceAdapterInterface
 * Defines the contract that every biometric terminal / gate barrier adapter must fulfill.
 * This guarantees the core application never tightly couples to vendor-specific SDKs or protocols.
 */

class DeviceAdapterInterface {
  constructor(deviceConfig) {
    if (new.target === DeviceAdapterInterface) {
      throw new TypeError('Cannot construct DeviceAdapterInterface directly; use a concrete subclass.');
    }
    this.deviceConfig = deviceConfig;
  }

  /**
   * Connect to or initialize communication with the physical or virtual device.
   * @returns {Promise<boolean>}
   */
  async connect() {
    throw new Error('Method connect() must be implemented.');
  }

  /**
   * Disconnect or release resources.
   * @returns {Promise<boolean>}
   */
  async disconnect() {
    throw new Error('Method disconnect() must be implemented.');
  }

  /**
   * Query device status, network ping, and memory health.
   * @returns {Promise<{ online: boolean, ip: string, firmware: string, lastHeartbeat: Date }>}
   */
  async getStatus() {
    throw new Error('Method getStatus() must be implemented.');
  }

  /**
   * Send a pulse signal to the turnstile gate relay solenoid to unlock tripod turnstile.
   * @param {number} durationMs - Duration in milliseconds to hold relay active (default 3000ms).
   * @returns {Promise<{ success: boolean, relayPin: number, durationMs: number }>}
   */
  async triggerTurnstileRelay(durationMs = 3000) {
    throw new Error('Method triggerTurnstileRelay() must be implemented.');
  }

  /**
   * Upload / sync student biometric profile (User ID, Card, Face Template) to terminal memory.
   * @param {Object} studentData
   * @returns {Promise<{ success: boolean, userId: string }>}
   */
  async syncStudent(studentData) {
    throw new Error('Method syncStudent() must be implemented.');
  }

  /**
   * Remove student from terminal memory (e.g. upon deactivation / graduation).
   * @param {string} biometricDeviceId
   * @returns {Promise<{ success: boolean }>}
   */
  async deleteStudent(biometricDeviceId) {
    throw new Error('Method deleteStudent() must be implemented.');
  }

  /**
   * Normalize vendor-specific incoming raw event payload into the standard internal SmartGate event format.
   * @param {Object} rawEvent
   * @returns {Object} Normalized event object
   */
  normalizeEvent(rawEvent) {
    throw new Error('Method normalizeEvent() must be implemented.');
  }
}

module.exports = DeviceAdapterInterface;
