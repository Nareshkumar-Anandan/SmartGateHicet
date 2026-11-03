const net = require('net');
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

const KNOWN_SERIALS = [
  'TW30000006260161',
  'TW30000006260175',
  'TW30000006260156',
  'TW30000006260127',
  'TW30000006260207',
  'TW30000006260242',
  'TW30000006260265',
  'TW30000006260256'
];

class AutoRegisterService {
  constructor() {
    this.servers = [];
    this.activeSockets = new Map(); // normalized serial_number -> socket
    this.recentPackets = []; // last 25 packets for remote diagnostics
    this.heartbeatInterval = null;
    this.listeningPorts = [];
  }

  /**
   * Clean up duplicate auto-created device rows (id > 8) and ensure all 8 real turnstile serials exist
   */
  async ensureCleanDeviceTable() {
    try {
      // Remove duplicate rows created with TW-xxxxxx code when the real TW-TF3000-LANEx row already exists
      await pool.query(`
        DELETE FROM gate_devices 
        WHERE device_code LIKE 'TW-%' 
          AND device_code NOT LIKE 'TW-TF3000-LANE%'
          AND id NOT IN (SELECT DISTINCT device_id FROM gate_events WHERE device_id IS NOT NULL)
      `);
    } catch (err) {
      console.warn('[AUTO-REG CLEANUP WARN]', err.message);
    }
  }

  /**
   * Start standalone TCP listeners (e.g., port 5050 and AUTO_REGISTER_PORT if not colliding with HTTP PORT)
   */
  start(httpPort = 7000) {
    if (this.servers.length > 0) return;

    this.ensureCleanDeviceTable();

    const candidatePorts = new Set([5050]);
    const envPort = parseInt(process.env.AUTO_REGISTER_PORT, 10);
    if (envPort && envPort !== Number(httpPort)) {
      candidatePorts.add(envPort);
    }

    for (const port of candidatePorts) {
      if (port === Number(httpPort)) continue;
      const srv = net.createServer(socket => {
        this._attachSocketHandlers(socket, `TCP:${port}`);
      });

      srv.on('error', err => {
        console.error(`[AUTO-REGISTRATION] TCP listener error on port ${port}:`, err.message);
      });

      srv.listen(port, '0.0.0.0', () => {
        this.listeningPorts.push(port);
        console.log(`[AUTO-REGISTRATION] Standalone TCP Listener active on port ${port}`);
      });

      this.servers.push(srv);
    }

    this.listeningPorts.push(`${httpPort} (Multiplexed HTTP+TCP)`);

    // Refresh heartbeat every 30s for all persistent open sockets
    if (!this.heartbeatInterval) {
      this.heartbeatInterval = setInterval(() => this._refreshActiveSocketHeartbeats(), 30000);
    }
  }

  /**
   * Adopt a raw TCP socket from Express http.Server 'clientError' event (Port 7000 / 5000)
   */
  handleHttpClientError(err, socket, portLabel = 'HTTP:7000') {
    if (!socket || socket.destroyed) return;

    const rawBuf = err && err.rawPacket ? err.rawPacket : null;

    // If this socket hasn't been adopted yet, strip HTTP server listeners and adopt it as a raw Auto-Reg socket
    if (!socket._adoptedByAutoReg) {
      socket._adoptedByAutoReg = true;
      socket.removeAllListeners('data');
      socket.removeAllListeners('error');
      socket.removeAllListeners('close');
      socket.removeAllListeners('timeout');
      socket.setTimeout(0);
      this._attachSocketHandlers(socket, portLabel, rawBuf);
    } else if (rawBuf && rawBuf.length > 0 && typeof socket._autoRegOnData === 'function') {
      socket._autoRegOnData(rawBuf);
    }
  }

  /**
   * Extract TimeWatch serial number from binary/ASCII Auto-Registration packet
   */
  extractSerialNumber(data) {
    if (!data || data.length === 0) return null;
    const latin1 = data.toString('latin1');
    const printable = latin1.replace(/[^\x20-\x7E]/g, ' ');

    // 1. Exact match for TW3000... serial format
    const m1 = printable.match(/TW3000[0-9A-Z]{6,14}/i);
    if (m1) return m1[0].toUpperCase();

    // 2. Match any TW... alphanumeric identifier >= 8 chars
    const m2 = printable.match(/TW[0-9A-Z]{6,18}/i);
    if (m2) return m2[0].toUpperCase();

    // 3. Check if any of the 8 known 6-digit suffixes (e.g. 260265, 260161) appear in the packet
    for (const fullSn of KNOWN_SERIALS) {
      const suffix6 = fullSn.slice(-6);
      if (printable.includes(suffix6)) {
        return fullSn;
      }
    }

    return null;
  }

  _attachSocketHandlers(socket, portLabel, initialBuffer = null) {
    const clientIp = socket.remoteAddress ? socket.remoteAddress.replace(/^.*:/, '') : 'UNKNOWN';
    try {
      socket.setKeepAlive(true, 15000);
    } catch {}

    const logPath = path.resolve(__dirname, '../../device_traffic.log');
    try {
      fs.appendFileSync(
        logPath,
        `[${new Date().toISOString()}] [${portLabel}] Connection from ${clientIp}:${socket.remotePort}\n`
      );
    } catch {}

    const onData = async (data) => {
      if (!data || data.length === 0) return;

      const latin1 = data.toString('latin1');
      const printable = latin1.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
      const hexPreview = data.slice(0, 64).toString('hex');

      const detectedSn = this.extractSerialNumber(data);
      if (detectedSn) {
        socket._regId = detectedSn;
      }

      const activeRegId = socket._regId || null;

      // Record in ring buffer for instant remote diagnostics
      this.recentPackets.unshift({
        timestamp: new Date().toISOString(),
        port: portLabel,
        clientIp,
        bytes: data.length,
        detectedSn: activeRegId,
        asciiPreview: printable.slice(0, 120),
        hexPreview
      });
      if (this.recentPackets.length > 25) {
        this.recentPackets.pop();
      }

      try {
        fs.appendFileSync(
          logPath,
          `[${new Date().toISOString()}] [${portLabel}] DATA (${data.length}b) from ${clientIp} [SN=${activeRegId || 'UNKNOWN'}]: ${printable.slice(0, 100)} | HEX: ${hexPreview}\n`
        );
      } catch {}

      console.log(`[AUTO-REG ${portLabel}] ${data.length}b from ${clientIp} -> SN=${activeRegId || 'NONE'} | ASCII="${printable.slice(0, 80)}"`);

      if (activeRegId) {
        this.activeSockets.set(activeRegId, socket);
        await this.markDeviceOnline(activeRegId, clientIp);
      }

      // Send ACK response back to terminal
      try {
        if (!socket.destroyed && socket.writable) {
          if (data.length >= 8 && (data.slice(0, 4).toString('ascii') === 'DHAV' || data.slice(0, 4).toString('ascii') === 'DVS')) {
            const ack = Buffer.from(data);
            ack.writeInt32LE(0, 4);
            socket.write(ack);
          } else if (data.length >= 32 && (data[0] === 0xf4 || data[0] === 0xf1 || data[0] === 0xa0)) {
            // Dahua NetSDK binary Auto-Registration / KeepAlive ACK
            const ack = Buffer.alloc(32, 0);
            ack[0] = 0xb0;
            data.copy(ack, 8, 8, 12); // echo sequence number
            socket.write(ack);
          } else {
            socket.write(Buffer.from('OK\r\n'));
          }
        }
      } catch (respErr) {
        console.warn('[AUTO-REG RESP WARN]', respErr.message);
      }
    };

    socket._autoRegOnData = onData;
    socket.on('data', onData);

    socket.on('error', err => {
      console.warn(`[AUTO-REG SOCKET WARN] [${portLabel}] ${clientIp}:`, err.message);
    });

    socket.on('close', () => {
      const sn = socket._regId;
      if (sn && this.activeSockets.get(sn) === socket) {
        this.activeSockets.delete(sn);
      }
    });

    // Process initial buffer immediately if handed over from http.Server clientError
    if (initialBuffer && initialBuffer.length > 0) {
      onData(initialBuffer);
    }
  }

  async markDeviceOnline(serialNumber, clientIp) {
    try {
      const cleanSn = serialNumber.trim().toUpperCase();
      const suffix6 = cleanSn.slice(-6);
      const [result] = await pool.query(
        `UPDATE gate_devices 
         SET status = 'ONLINE', 
             ip_address = ?, 
             last_heartbeat = NOW(), 
             integration_mode = 'HARDWARE_API',
             updated_at = NOW() 
         WHERE UPPER(serial_number) = ? OR serial_number LIKE ?`,
        [clientIp, cleanSn, `%${suffix6}`]
      );
      if (result.affectedRows > 0) {
        console.log(`[AUTO-REG DB] Marked device ${cleanSn} (${clientIp}) ONLINE (${result.affectedRows} row updated).`);
      }
    } catch (dbErr) {
      console.error('[AUTO-REG DB ERROR]', dbErr.message);
    }
  }

  async _refreshActiveSocketHeartbeats() {
    for (const [sn, socket] of this.activeSockets.entries()) {
      if (!socket || socket.destroyed) {
        this.activeSockets.delete(sn);
        continue;
      }
      const clientIp = socket.remoteAddress ? socket.remoteAddress.replace(/^.*:/, '') : '127.0.0.1';
      await this.markDeviceOnline(sn, clientIp);
    }
  }

  isDeviceConnected(serialNumber) {
    if (!serialNumber) return false;
    const cleanSn = serialNumber.trim().toUpperCase();
    const sock = this.activeSockets.get(cleanSn);
    return Boolean(sock && !sock.destroyed);
  }

  getDiagnostics() {
    return {
      listeningPorts: this.listeningPorts,
      activeConnectedDevices: Array.from(this.activeSockets.keys()),
      recentPackets: this.recentPackets.slice(0, 10)
    };
  }

  /**
   * Send remote barrier unlock trigger over active Auto-Registration socket
   */
  async triggerRelay(regId = 'TW30000006260207') {
    const cleanSn = (regId || '').trim().toUpperCase();
    const socket = this.activeSockets.get(cleanSn);
    if (!socket || socket.destroyed) {
      console.warn(`[AUTO-REG] No active socket found for ${cleanSn}`);
      return false;
    }

    try {
      const cmd = JSON.stringify({
        method: 'accessControl.openDoor',
        params: { channel: 1, duration: 3 },
        id: Date.now()
      }) + '\r\n';
      socket.write(Buffer.from(cmd));
      console.log(`[AUTO-REG COMMAND] Sent openDoor command to ${cleanSn}`);
      return true;
    } catch (err) {
      console.error('[AUTO-REG COMMAND ERROR]', err.message);
      return false;
    }
  }
}

module.exports = new AutoRegisterService();
