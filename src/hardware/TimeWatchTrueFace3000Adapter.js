const DeviceAdapterInterface = require('./DeviceAdapterInterface');
const crypto = require('crypto');
const timewatchHardwareCgiService = require('../services/timewatchHardwareCgiService');

/**
 * TimeWatchTrueFace3000Adapter
 * Hardware adapter for TimeWatch TrueFace3000 (ADPM) Face Recognition Terminals.
 * Supports:
 * - Direct HTTP Digest CGI barrier unlock command (/cgi-bin/accessControl.cgi?action=openDoor&channel=1)
 * - ADMS / Cloud HTTP PUSH event callbacks
 * - Biometric verification mode translation (Face, Mifare RFID Card, Password, QR Code)
 * - Turnstile relay unlock pulse trigger via device dry contact relay (NO / COM terminals)
 * - Anti-passback & device synchronization
 */
class TimeWatchTrueFace3000Adapter extends DeviceAdapterInterface {
  constructor(deviceConfig) {
    super(deviceConfig);
    this.serialNumber = deviceConfig.serial_number;
    this.ip = deviceConfig.ip_address;
    this.port = deviceConfig.port;
    this.isOnline = deviceConfig.status === 'ONLINE';
    this.model = 'TrueFace3000 (ADPM)';
    this.vendor = 'TimeWatch';
  }

  async connect() {
    // In production, initiate socket / HTTP health check with terminal IP:port
    this.isOnline = true;
    return true;
  }

  async disconnect() {
    this.isOnline = false;
    return true;
  }

  async getStatus() {
    let isLive = false;

    // 0. Check if active Auto-Registration socket is connected for this serial number
    const autoRegisterService = require('../services/autoRegisterService');
    if (autoRegisterService.isDeviceConnected(this.serialNumber)) {
      isLive = true;
    }

    // 1. Check if recent heartbeat exists (within 300s)
    if (!isLive && this.deviceConfig.last_heartbeat) {
      const hbStr = String(this.deviceConfig.last_heartbeat);
      const hbTime = new Date(hbStr.includes('T') ? hbStr : hbStr.replace(' ', 'T') + 'Z').getTime();
      if (Date.now() - hbTime < 300000 && this.deviceConfig.status === 'ONLINE') {
        isLive = true;
      }
    }

    // 2. If not already verified live by fresh heartbeat, probe device IP:port via TCP socket (800ms timeout)
    if (!isLive && this.ip) {
      try {
        const net = require('net');
        // Terminals listen on port 80 for HTTP / CGI web management
        const probePort = (this.port && this.port !== 8080) ? this.port : 80;
        isLive = await new Promise(resolve => {
          const socket = new net.Socket();
          socket.setTimeout(800);
          socket.once('connect', () => {
            socket.destroy();
            resolve(true);
          });
          socket.once('timeout', () => {
            socket.destroy();
            resolve(false);
          });
          socket.once('error', () => {
            socket.destroy();
            resolve(false);
          });
          socket.connect(probePort, this.ip);
        });
      } catch (err) {
        isLive = false;
      }
    }

    this.isOnline = isLive;

    return {
      online: isLive,
      ip: this.ip,
      port: this.port,
      serialNumber: this.serialNumber,
      model: this.model,
      vendor: this.vendor,
      firmware: this.deviceConfig.firmware_version || 'TW-ADPM-v2.6.4',
      lastHeartbeat: this.deviceConfig.last_heartbeat,
      integrationMode: this.deviceConfig.integration_mode
    };
  }

  /**
   * Triggers the TimeWatch TrueFace3000 internal NO/COM dry contact relay.
   * Directly dispatches HTTP Digest Authenticated CGI command (/cgi-bin/accessControl.cgi?action=openDoor&channel=1)
   * to send an electrical contact closure to the Turnstile Control Board (IN1 / GND).
   */
  async triggerTurnstileRelay(durationMs = 10000) {
    if (this.deviceConfig.integration_mode === 'SIMULATED') {
      return {
        success: true,
        relayPin: this.deviceConfig.turnstile_relay_pin || 1,
        durationMs,
        mode: 'SIMULATED_BRIDGE',
        message: `[TimeWatch TrueFace3000 Simulator] Turnstile relay pulse commanded (${durationMs}ms)`
      };
    }

    // 1. Try active Auto-Registration TCP socket first (works across Cloud VPS -> College NAT)
    const autoRegisterService = require('../services/autoRegisterService');
    if (autoRegisterService.isDeviceConnected(this.serialNumber)) {
      const triggered = await autoRegisterService.triggerRelay(this.serialNumber);
      if (triggered) {
        return {
          success: true,
          ip: this.ip,
          relayPin: this.deviceConfig.turnstile_relay_pin || 1,
          durationMs,
          mode: 'AUTO_REGISTER_SOCKET',
          message: `TimeWatch TrueFace3000 barrier unlock command dispatched over active Auto-Registration socket to ${this.serialNumber}.`
        };
      }
    }

    // 2. Direct Physical Hardware Trigger via Dahua/TimeWatch CGI (when on local LAN)
    if (this.ip && !this.ip.startsWith('121.200.')) {
      console.log(`[HARDWARE DISPATCH] Sending direct CGI openDoor command to ${this.ip}:80 (Channel 1)...`);
      try {
        const cgiResult = await timewatchHardwareCgiService.openBarrier(this.ip, 1);
        if (cgiResult.success) {
          console.log(`[HARDWARE DISPATCH] SUCCESS: Barrier unlocked on ${this.serialNumber} (${this.ip})`);
          return {
            success: true,
            ip: this.ip,
            relayPin: this.deviceConfig.turnstile_relay_pin || 1,
            durationMs,
            mode: 'HARDWARE_CGI',
            message: `TimeWatch TrueFace3000 barrier successfully unlocked on terminal ${this.serialNumber} (${this.ip}). Turnstile permission granted.`
          };
        } else {
          console.warn(`[HARDWARE DISPATCH] CGI openDoor returned warning: ${cgiResult.message || cgiResult.error}`);
        }
      } catch (cgiErr) {
        console.error(`[HARDWARE DISPATCH ERROR] Failed CGI openDoor on ${this.ip}:`, cgiErr.message);
      }
    }

    // Fallback queue for ADMS if direct IP is not reachable
    const admsService = require('../services/admsService');
    const cmdId = admsService.queueCommand(this.serialNumber, 'AC_UNLK');
    console.log(`[HARDWARE DISPATCH] AC_UNLK queued for TimeWatch TrueFace3000 (${this.serialNumber}) [Cmd #${cmdId}]`);

    return {
      success: true,
      commandId: cmdId,
      relayPin: this.deviceConfig.turnstile_relay_pin || 1,
      durationMs,
      mode: 'HARDWARE_API',
      message: `TimeWatch TrueFace3000 barrier unlock command queued for terminal ${this.serialNumber}. Turnstile lane commanded to unlock.`
    };
  }

  async syncStudent(studentData) {
    const userId = studentData.biometric_device_id || `TW-UID-${studentData.id}`;
    const name = `${studentData.first_name} ${studentData.last_name}`;

    if (this.deviceConfig.integration_mode === 'HARDWARE_API') {
      const timewatchApiService = require('../services/timewatchApiService');
      const apiRes = await timewatchApiService.addUser({
        UserID: userId,
        Name: name,
        DeviceID: this.serialNumber,
        Card: studentData.card_number || '',
        FaceTemplate: studentData.face_template || ''
      });
      return {
        success: apiRes.success,
        userId,
        deviceCode: this.deviceConfig.device_code,
        message: apiRes.success
          ? `Enrolled student ${name} on TimeWatch terminal ${this.serialNumber} via TWAPI`
          : `TWAPI AddUser warning: ${apiRes.message}`,
        details: apiRes
      };
    }

    return {
      success: true,
      userId,
      deviceCode: this.deviceConfig.device_code,
      message: `Enrolled student ${name} on TimeWatch terminal ${this.serialNumber} (Simulated)`
    };
  }

  async deleteStudent(biometricDeviceId) {
    if (this.deviceConfig.integration_mode === 'HARDWARE_API') {
      const timewatchApiService = require('../services/timewatchApiService');
      const apiRes = await timewatchApiService.deleteUser({
        UserID: biometricDeviceId,
        DeviceID: this.serialNumber
      });
      return {
        success: apiRes.success,
        userId: biometricDeviceId,
        message: apiRes.success
          ? `Revoked biometric access for ID ${biometricDeviceId} on TimeWatch terminal ${this.serialNumber} via TWAPI`
          : `TWAPI DeleteUser warning: ${apiRes.message}`,
        details: apiRes
      };
    }

    return {
      success: true,
      userId: biometricDeviceId,
      message: `Revoked biometric access for ID ${biometricDeviceId} on TimeWatch terminal ${this.serialNumber} (Simulated)`
    };
  }

  /**
   * Normalizes raw TimeWatch ADPM PUSH packet or JSON event
   * Supported formats:
   * Format A (JSON payload from Webhook/Cloud):
   * {
   *   "sn": "TW30000000260207",
   *   "user_id": "TW-UID-1001",
   *   "timestamp": "2026-10-13 18:30:15",
   *   "verify_mode": 15, // 15=Face, 4=Card, 1=Password, 20=QR
   *   "in_out_mode": 0,  // 0=Entry, 1=Exit
   *   "card_no": "CRD-882101"
   * }
   */
  normalizeEvent(rawEvent) {
    let verificationType = 'FACE';
    if (rawEvent.verify_mode === 4 || rawEvent.verificationType === 'CARD') {
      verificationType = 'CARD';
    } else if (rawEvent.verify_mode === 1 || rawEvent.verificationType === 'PASSWORD') {
      verificationType = 'PASSWORD';
    } else if (rawEvent.verify_mode === 20 || rawEvent.verificationType === 'QR') {
      verificationType = 'QR';
    }

    let direction = 'ENTRY';
    if (rawEvent.in_out_mode === 1 || rawEvent.direction === 'EXIT') {
      direction = 'EXIT';
    } else if (rawEvent.direction === 'ENTRY') {
      direction = 'ENTRY';
    } else {
      direction = this.deviceConfig.lane_direction === 'EXIT' ? 'EXIT' : 'ENTRY';
    }

    const eventTime = rawEvent.timestamp ? new Date(rawEvent.timestamp) : new Date();
    const biometricId = rawEvent.user_id || rawEvent.biometricDeviceId || null;
    const cardNo = rawEvent.card_no || rawEvent.cardNumber || null;

    return {
      eventUuid: rawEvent.event_uuid || crypto.randomUUID(),
      deviceId: this.deviceConfig.id,
      deviceCode: this.deviceConfig.device_code,
      biometricDeviceId: biometricId,
      cardNumber: cardNo,
      timestamp: eventTime,
      direction,
      verificationType,
      eventSource: this.deviceConfig.integration_mode === 'HARDWARE_API' ? 'HARDWARE' : 'SIMULATED',
      rawPayload: rawEvent
    };
  }
}

module.exports = TimeWatchTrueFace3000Adapter;
