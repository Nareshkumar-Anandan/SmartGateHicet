const { pool } = require('../config/database');
const crypto = require('crypto');

class AdmsService {
  constructor() {
    // In-memory command queue per device serial number: SN -> [ { id, cmd, timestamp } ]
    this.commandQueues = new Map();
    this.commandCounter = 1;
  }

  normalizeSn(sn) {
    if (!sn) return '';
    return sn.trim().toUpperCase();
  }

  /**
   * Queue a remote command (e.g. AC_UNLK for barrier open) to be picked up by the terminal
   */
  queueCommand(serialNumber, commandStr, silent = false) {
    const sn = this.normalizeSn(serialNumber);
    if (!this.commandQueues.has(sn)) {
      this.commandQueues.set(sn, []);
    }
    const cmdId = this.commandCounter++;
    const cmdObj = {
      id: cmdId,
      cmd: commandStr,
      timestamp: Date.now()
    };
    this.commandQueues.get(sn).push(cmdObj);
    if (!silent) {
      const preview = commandStr.length > 100 ? commandStr.slice(0, 100) + '...' : commandStr;
      console.log(`[ADMS QUEUE] Command queued for ${sn}: C:${cmdId}:${preview}`);
    }
    return cmdId;
  }

  /**
   * Auto-register or update device heartbeat in database
   */
  async recordDeviceHeartbeat(sn, clientIp) {
    try {
      const cleanSn = this.normalizeSn(sn);
      if (!cleanSn) return null;

      // Find by exact serial number or normalized prefix/suffix
      const [rows] = await pool.query(
        'SELECT * FROM gate_devices WHERE serial_number = ? OR serial_number LIKE ? LIMIT 1',
        [cleanSn, `%${cleanSn.replace(/TW30000+/i, '')}%`]
      );

      let cleanIp = clientIp || '127.0.0.1';
      if (cleanIp.includes('::ffff:')) {
        cleanIp = cleanIp.replace('::ffff:', '');
      }

      if (rows.length > 0) {
        // Update heartbeat and IP
        await pool.query(
          `UPDATE gate_devices 
           SET status = 'ONLINE', last_heartbeat = NOW(), ip_address = ?, updated_at = NOW() 
           WHERE id = ?`,
          [cleanIp, rows[0].id]
        );
        return rows[0];
      } else {
        // Auto-register new physical device
        const deviceCode = `TW-${cleanSn.slice(-6)}`;
        const deviceName = `Hostel Gate Terminal (${cleanSn})`;

        const [insertResult] = await pool.query(
          `INSERT INTO gate_devices 
           (device_code, device_name, manufacturer, model, serial_number, ip_address, port, location_description, lane_direction, status, last_heartbeat, integration_mode)
           VALUES (?, ?, 'TimeWatch', 'TrueFace3000 (ADPM)', ?, ?, 8080, 'Hostel Main Gate Turnstile Lane', 'BIDIRECTIONAL', 'ONLINE', NOW(), 'HARDWARE_API')`,
          [deviceCode, deviceName, cleanSn, cleanIp]
        );

        console.log(`[ADMS AUTO-REGISTER] New TimeWatch TrueFace3000 registered: ${cleanSn} (ID: ${insertResult.insertId})`);
        
        const [newDevice] = await pool.query('SELECT * FROM gate_devices WHERE id = ?', [insertResult.insertId]);
        return newDevice[0];
      }
    } catch (err) {
      console.error('[ADMS] Error recording device heartbeat:', err);
      return null;
    }
  }

  /**
   * Handle terminal handshake and configuration options: GET /iclock/cdata?SN=...
   */
  async handleHandshake(req, res) {
    const sn = req.query.SN || req.query.sn;
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    console.log(`[ADMS HANDSHAKE] Device connected: SN=${sn} from ${clientIp}`);

    if (sn) {
      await this.recordDeviceHeartbeat(sn, clientIp);
    }

    const stamp = Math.floor(Date.now() / 1000);

    // Standard ADMS / iclock configuration response expected by TimeWatch / ZK firmware
    const responsePayload = [
      `GET OPTION FROM: ${sn || 'TERMINAL'}`,
      `Stamp=${stamp}`,
      `OpStamp=${stamp}`,
      `PhotoStamp=${stamp}`,
      `ErrorDelay=30`,
      `Delay=10`,
      `TransTimes=00:00;14:05`,
      `TransInterval=1`,
      `TransFlag=1111111111`,
      `TimeZone=5.5`,
      `Realtime=1`,
      `Encrypt=0`,
      `ServerVersion=3.0.1`
    ].join('\n');

    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send(responsePayload);
  }

  /**
   * Handle incoming punch logs: POST /iclock/cdata?SN=...&table=ATTLOG
   */
  async handlePunchLogs(req, res) {
    const sn = req.query.SN || req.query.sn;
    const table = req.query.table || req.query.Table;
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    console.log(`[ADMS PUNCH DATA] SN=${sn}, table=${table}, body length=${req.body ? req.body.length : 0}`);

    const device = await this.recordDeviceHeartbeat(sn, clientIp);

    // 1. Terminal Push of Enrolled Users (table=USER or table=USERINFO)
    if (table && (table.toUpperCase() === 'USER' || table.toUpperCase() === 'USERINFO' || table.toUpperCase() === 'BIODATA')) {
      const rawText = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      const lines = rawText.split(/\r?\n/).filter(l => l.trim().length > 0);
      let userCount = 0;

      for (const line of lines) {
        try {
          // Parse ADMS key-value format (PIN=101\tName=John\tCard=123) or tab-delimited
          let pin = '';
          let name = '';
          let card = '';

          if (line.includes('PIN=') || line.includes('Name=')) {
            const parts = line.split('\t');
            for (const part of parts) {
              const eqIdx = part.indexOf('=');
              if (eqIdx !== -1) {
                const key = part.slice(0, eqIdx).trim().toUpperCase();
                const val = part.slice(eqIdx + 1).trim();
                if (key === 'PIN') pin = val;
                else if (key === 'NAME') name = val;
                else if (key === 'CARD') card = val;
              }
            }
          } else {
            const parts = line.split('\t');
            if (parts.length >= 1) pin = parts[0].trim();
            if (parts.length >= 2) name = parts[1].trim();
            if (parts.length >= 3 && /^\d+$/.test(parts[2].trim())) card = parts[2].trim();
          }

          if (pin) {
            await this.syncTerminalUserToDatabase({ pin, name, card, sn });
            userCount++;
          }
        } catch (uErr) {
          console.error('[ADMS] Error parsing USER line:', line, uErr);
        }
      }

      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(`OK: ${userCount}`);
    }

    // 2. Terminal Push of Attendance Punches (table=ATTLOG)
    if (table && table.toUpperCase() === 'ATTLOG') {
      const eventProcessor = require('./eventProcessor');
      const rawText = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      const lines = rawText.split(/\r?\n/).filter(l => l.trim().length > 0);
      let successCount = 0;

      for (const line of lines) {
        try {
          // TimeWatch ATTLOG tab-delimited format:
          // Format 1: PIN \t Timestamp \t Status \t VerifyType \t WorkCode \t Reserved
          // Format 2: PIN \t Timestamp \t ...
          const parts = line.split('\t');
          if (parts.length >= 2) {
            const rawPin = parts[0].trim();
            const rawTime = parts[1].trim();
            const inOutState = parts[2] ? parseInt(parts[2].trim(), 10) : 0;
            const verifyTypeNum = parts[3] ? parseInt(parts[3].trim(), 10) : 15;

            // Map verify type
            let verificationType = 'FACE';
            if (verifyTypeNum === 4) verificationType = 'CARD';
            else if (verifyTypeNum === 1) verificationType = 'PASSWORD';
            else if (verifyTypeNum === 20) verificationType = 'QR';

            // Map direction
            let direction = 'ENTRY';
            if (inOutState === 1) {
              direction = 'EXIT';
            } else if (device && device.lane_direction) {
              direction = device.lane_direction === 'EXIT' ? 'EXIT' : 'ENTRY';
            }

            // Check if student exists; if user was enrolled on the machine, auto-sync into SmartGate
            const [sCheck] = await pool.query(
              'SELECT id FROM students WHERE biometric_device_id = ? OR student_id = ? LIMIT 1',
              [rawPin, rawPin]
            );

            if (sCheck.length === 0) {
              // Attempt to fetch name/card from terminal API if possible
              let fetchedName = '';
              let fetchedCard = verifyTypeNum === 4 ? rawPin : null;
              try {
                const timewatchApiService = require('./timewatchApiService');
                const uRes = await timewatchApiService.getUserDetail({ UserID: rawPin, DeviceID: sn });
                if (uRes.success && uRes.data) {
                  const u = uRes.data;
                  if (u.Name && u.Name !== 'Biometric Student' && u.Name !== 'Enrolled User') {
                    fetchedName = u.Name;
                  }
                  if (u.Card) fetchedCard = u.Card;
                }
              } catch {}

              await this.syncTerminalUserToDatabase({
                pin: rawPin,
                name: fetchedName || `Student ${rawPin}`,
                card: fetchedCard,
                sn
              });
            }

            const normalizedEvent = {
              eventUuid: crypto.randomUUID(),
              deviceId: device ? device.id : null,
              deviceCode: device ? device.device_code : `TW-${sn}`,
              biometricDeviceId: rawPin,
              studentId: rawPin, // Also try as student roll number
              cardNumber: verifyTypeNum === 4 ? rawPin : null,
              timestamp: rawTime ? new Date(rawTime) : new Date(),
              direction,
              verificationType,
              eventSource: 'HARDWARE',
              rawPayload: { line, sn }
            };

            const decision = await eventProcessor.processEvent(normalizedEvent);
            console.log(`[ADMS PUNCH PROCESSED] PIN=${rawPin}, Result=${decision.accessResult}, Unlocked=${decision.relayTriggered}`);

            // If access granted, command turnstile relay to unlock!
            if (decision.accessResult === 'GRANTED') {
              this.queueCommand(sn, 'AC_UNLK');
            }

            successCount++;
          }
        } catch (lineErr) {
          console.error('[ADMS] Error parsing ATTLOG line:', line, lineErr);
        }
      }

      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(`OK: ${successCount}`);
    }

    // Default acknowledgement for other tables (e.g. OPERLOG)
    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send('OK');
  }

  /**
   * Terminal polling for remote commands: GET /iclock/getrequest?SN=...
   */
  async handleGetRequest(req, res) {
    const sn = this.normalizeSn(req.query.SN || req.query.sn);
    res.setHeader('Content-Type', 'text/plain');

    if (!sn || !this.commandQueues.has(sn) || this.commandQueues.get(sn).length === 0) {
      return res.status(200).send('OK');
    }

    const queue = this.commandQueues.get(sn);
    const cmdObj = queue.shift(); // Dequeue next command

    console.log(`[ADMS DISPATCH] Sending command to ${sn}: C:${cmdObj.id}:${cmdObj.cmd}`);
    return res.status(200).send(`C:${cmdObj.id}:${cmdObj.cmd}\n`);
  }

  /**
   * Terminal reporting command result: POST /iclock/devicecmd?SN=...
   */
  async handleDeviceCmd(req, res) {
    const sn = req.query.SN || req.query.sn;
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    console.log(`[ADMS CMD ACK] SN=${sn}, Response=${rawBody}`);

    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send('OK');
  }

  /**
   * Biometric / photo upload: POST /iclock/fdata
   */
  async handleFData(req, res) {
    const sn = req.query.SN || req.query.sn;
    console.log(`[ADMS FDATA] Photo upload from SN=${sn}`);

    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send('OK');
  }

  /**
   * Sync or auto-enroll a terminal user into SmartGate database
   */
  async syncTerminalUserToDatabase({ pin, name, card, sn }) {
    try {
      const cleanPin = String(pin).trim();
      if (!cleanPin || cleanPin === 'ALL') return null;

      const [existing] = await pool.query(
        'SELECT id, first_name, last_name, card_number, biometric_device_id FROM students WHERE biometric_device_id = ? OR student_id = ? LIMIT 1',
        [cleanPin, cleanPin]
      );

      if (existing.length > 0) {
        // Update existing student with biometric enrollment flag and card if provided
        const student = existing[0];
        const updateFields = ['biometric_enrolled = 1'];
        const updateParams = [];

        if (card && (!student.card_number || student.card_number !== card)) {
          updateFields.push('card_number = ?');
          updateParams.push(card);
        }

        updateParams.push(student.id);
        await pool.query(
          `UPDATE students SET ${updateFields.join(', ')} WHERE id = ?`,
          updateParams
        );
        console.log(`[ADMS USER SYNC] Verified/Updated existing student ${student.first_name} ${student.last_name} (${cleanPin}) from terminal ${sn}`);
        return student;
      } else {
        // Auto-create newly enrolled terminal user in SmartGate
        const rawName = (name && name.trim()) || `Student ${cleanPin}`;
        const nameParts = rawName.split(' ');
        const firstName = nameParts[0] || rawName;
        const lastName = nameParts.slice(1).join(' ') || '(Terminal Enrolled)';
        const studentRoll = `TW-${cleanPin}`;
        const cleanEmail = `stu_${cleanPin.toLowerCase().replace(/[^a-z0-9]/g, '')}@hicet.ac.in`;

        const [insertRes] = await pool.query(
          `INSERT INTO students 
           (student_id, first_name, last_name, department, course, year_of_study, phone, parent_phone, email, current_location_status, biometric_device_id, biometric_enrolled, card_number, is_active)
           VALUES (?, ?, ?, 'Engineering', 'B.E.', 1, '9000000000', '9000000000', ?, 'INSIDE', ?, 1, ?, 1)`,
          [
            studentRoll,
            firstName,
            lastName,
            cleanEmail,
            cleanPin,
            card || null
          ]
        );

        console.log(`[ADMS USER SYNC] Auto-enrolled new student ${firstName} ${lastName} (${cleanPin}) from terminal ${sn} into SmartGate.`);
        return {
          id: insertRes.insertId,
          student_id: studentRoll,
          first_name: firstName,
          last_name: lastName,
          biometric_device_id: cleanPin
        };
      }
    } catch (err) {
      console.error(`[ADMS USER SYNC ERROR] ${pin}:`, err.message);
      return null;
    }
  }
}

module.exports = new AdmsService();
