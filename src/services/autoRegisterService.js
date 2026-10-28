const net = require('net');
const { pool } = require('../config/database');
const eventProcessor = require('./eventProcessor');

class AutoRegisterService {
  constructor() {
    this.server = null;
    this.activeSockets = new Map(); // RegistrationID -> socket
    this.port = process.env.AUTO_REGISTER_PORT || 7000;
  }

  start() {
    if (this.server) return;

    this.server = net.createServer(socket => {
      const clientIp = socket.remoteAddress ? socket.remoteAddress.replace(/^.*:/, '') : 'UNKNOWN';
      const fs = require('fs');
      const path = require('path');
      const logPath = path.resolve(__dirname, '../../device_traffic.log');
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] Port 7000 Connection from ${clientIp}:${socket.remotePort}\n`);

      let regId = 'TW30000006260207';

      socket.on('data', async data => {
        const hexStr = data.toString('hex');
        const asciiStr = data.toString('ascii');
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] Port 7000 DATA (${data.length}b) from ${clientIp}: ${asciiStr.slice(0, 100)}\n`);
        console.log(`[AUTO-REG DATA] Received ${data.length} bytes from ${clientIp}`);
        console.log(`[AUTO-REG ASCII]`, asciiStr.slice(0, 300));

        // Check if packet contains registration ID
        const match = asciiStr.match(/TW[0-9A-Z]+/i);
        if (match) {
          regId = match[0];
          console.log(`[AUTO-REG IDENTIFIED] Registration ID: ${regId}`);
        }

        this.activeSockets.set(regId, socket);

        // Update database device status to ONLINE with terminal IP
        try {
          await pool.query(
            `UPDATE gate_devices 
             SET status = 'ONLINE', ip_address = ?, last_heartbeat = NOW(), updated_at = NOW() 
             WHERE serial_number = ?`,
            [clientIp, regId]
          );
          console.log(`[AUTO-REG DB] Gate device ${regId} marked ONLINE in database.`);
        } catch (dbErr) {
          console.error('[AUTO-REG DB ERROR]', dbErr.message);
        }

        // Send generic acknowledgment packet
        // Dahua / TimeWatch standard ACK response
        try {
          if (data.length >= 8) {
            const ack = Buffer.from(data);
            // If Dahua DHAV / NetSDK packet, return status OK (0)
            if (data.slice(0, 4).toString('ascii') === 'DHAV' || data.slice(0, 4).toString('ascii') === 'DVS') {
              ack.writeInt32LE(0, 4); // return code 0 = Success
              socket.write(ack);
            } else {
              // Return echo or standard OK
              const okResponse = Buffer.from('OK\r\n');
              socket.write(okResponse);
            }
          } else {
            socket.write(Buffer.from('OK\r\n'));
          }
        } catch (respErr) {
          console.error('[AUTO-REG RESP ERROR]', respErr.message);
        }
      });

      socket.on('error', err => {
        console.warn(`[AUTO-REG SOCKET ERROR] ${clientIp}:`, err.message);
      });

      socket.on('close', () => {
        console.log(`[AUTO-REG DISCONNECT] Terminal disconnected from ${clientIp}`);
        this.activeSockets.delete(regId);
      });
    });

    this.server.listen(this.port, '0.0.0.0', () => {
      console.log(`[AUTO-REGISTRATION] Auto-Registration TCP Listener active on port ${this.port}`);
    });

    this.server.on('error', err => {
      console.error('[AUTO-REGISTRATION] Server error:', err.message);
    });
  }

  /**
   * Send remote barrier unlock trigger over active Auto-Registration socket
   */
  async triggerRelay(regId = 'TW30000006260207') {
    const socket = this.activeSockets.get(regId);
    if (!socket || socket.destroyed) {
      console.warn(`[AUTO-REG] No active socket found for ${regId}`);
      return false;
    }

    try {
      // Send Dahua / TimeWatch relay trigger command
      const cmd = JSON.stringify({
        method: 'accessControl.openDoor',
        params: { channel: 1, duration: 3 },
        id: Date.now()
      }) + '\r\n';
      socket.write(Buffer.from(cmd));
      console.log(`[AUTO-REG COMMAND] Sent openDoor command to ${regId}`);
      return true;
    } catch (err) {
      console.error('[AUTO-REG COMMAND ERROR]', err.message);
      return false;
    }
  }
}

module.exports = new AutoRegisterService();
