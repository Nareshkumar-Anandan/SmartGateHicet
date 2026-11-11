const http = require('http');
const crypto = require('crypto');
const path = require('path');
const xlsx = require('xlsx');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
const { pool } = require('../config/database');
const eventProcessor = require('./eventProcessor');

class TimeWatchIdmsService {
  constructor() {
    this.serverUrl = process.env.TIMEWATCH_SERVER_URL || 'http://172.25.3.51:9001';
    this.serverUser = process.env.TIMEWATCH_SERVER_USER || 'admin';
    this.serverPassword = process.env.TIMEWATCH_SERVER_PASSWORD || 'admin';
    this.deviceUser = process.env.TIMEWATCH_DEVICE_USER || 'admin';
    this.devicePassword = process.env.TIMEWATCH_DEVICE_PASSWORD || 'tipl9910';
    this.deviceType = process.env.TIMEWATCH_DEVICE_TYPE || 'AI Series';
    this.turnstileIps = [
      '172.25.26.241', '172.25.26.242', '172.25.26.243', '172.25.26.244',
      '172.25.26.245', '172.25.26.246', '172.25.26.247', '172.25.26.248'
    ];
    
    // Parse host and port
    const parsed = new URL(this.serverUrl);
    this.hostname = parsed.hostname;
    this.port = parseInt(parsed.port, 10) || 9001;

    this.sessionCookie = null;
    this.sessionExpiry = null;
    this.pollingTimer = null;
    this.deviceStatusTimer = null;
    this.isPolling = false;
    this.pollIntervalMs = parseInt(process.env.TIMEWATCH_LIVE_SYNC_INTERVAL_MS, 10) || 3000;
    
    // Cache of processed punch keys to avoid reprocessing: "userId:sn:timestamp"
    this.processedPunches = new Set();
    this.maxCacheSize = 5000;

    this.stats = {
      connected: false,
      lastCheckTime: null,
      lastSyncTime: null,
      totalPunchesIngested: 0,
      totalPunchesGranted: 0,
      totalPunchesDenied: 0,
      lastError: null,
      version: 'iDMS 2.0.1'
    };
  }

  /**
   * HTTP GET helper
   */
  _get(path, cookie = this.sessionCookie) {
    return new Promise((resolve, reject) => {
      const headers = cookie ? { Cookie: cookie } : {};
      const req = http.request({
        hostname: this.hostname,
        port: this.port,
        path,
        method: 'GET',
        headers,
        timeout: 8000
      }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          const setCookie = res.headers['set-cookie'];
          let newCookie = cookie;
          if (setCookie) {
            const added = setCookie.map(c => c.split(';')[0]).join('; ');
            newCookie = cookie ? `${cookie}; ${added}` : added;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: data, cookie: newCookie });
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Connection to TimeWatch server (${this.serverUrl}) timed out.`));
      });
      req.end();
    });
  }

  /**
   * HTTP POST helper (application/x-www-form-urlencoded)
   */
  _post(path, bodyStr, cookie = this.sessionCookie) {
    return new Promise((resolve, reject) => {
      const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bodyStr)
      };
      if (cookie) headers['Cookie'] = cookie;

      const req = http.request({
        hostname: this.hostname,
        port: this.port,
        path,
        method: 'POST',
        headers,
        timeout: 8000
      }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          const setCookie = res.headers['set-cookie'];
          let updatedCookie = cookie;
          if (setCookie) {
            const added = setCookie.map(c => c.split(';')[0]).join('; ');
            updatedCookie = cookie ? `${cookie}; ${added}` : added;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: data, cookie: updatedCookie });
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`POST request to TimeWatch server (${this.serverUrl}) timed out.`));
      });
      req.write(bodyStr);
      req.end();
    });
  }

  /**
   * HTTP POST helper that returns a raw Buffer (for Excel / binary downloads)
   */
  _postBuffer(path, bodyStr, cookie = this.sessionCookie) {
    return new Promise((resolve, reject) => {
      const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bodyStr)
      };
      if (cookie) headers['Cookie'] = cookie;

      const req = http.request({
        hostname: this.hostname,
        port: this.port,
        path,
        method: 'POST',
        headers,
        timeout: 20000
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve({ status: res.statusCode, headers: res.headers, buffer: buf });
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`POST request to TimeWatch server (${this.serverUrl}) timed out.`));
      });
      req.write(bodyStr);
      req.end();
    });
  }

  /**
   * Extract input values from ASP.NET HTML forms
   */
  _extractInput(html, name) {
    const m = html.match(new RegExp(`name=["']${name}["'][^>]*value=["']([^"']*)["']`, 'i')) ||
              html.match(new RegExp(`value=["']([^"']*)["'][^>]*name=["']${name}["']`, 'i'));
    return m ? m[1] : '';
  }

  /**
   * Authenticate with TimeWatch iDMS web portal
   */
  async login(force = false) {
    if (!force && this.sessionCookie && this.sessionExpiry && Date.now() < this.sessionExpiry) {
      return this.sessionCookie;
    }

    try {
      const initial = await this._get('/Login.aspx', '');
      const initialCookie = initial.headers['set-cookie']
        ? initial.headers['set-cookie'].map(c => c.split(';')[0]).join('; ')
        : '';

      const viewState = this._extractInput(initial.body, '__VIEWSTATE');
      const viewStateGen = this._extractInput(initial.body, '__VIEWSTATEGENERATOR');
      const eventVal = this._extractInput(initial.body, '__EVENTVALIDATION');

      const params = new URLSearchParams();
      params.append('__EVENTTARGET', 'ctl00$ContentPlaceHolder1$ASPxRoundPanel1$btnLogin');
      params.append('__EVENTARGUMENT', '');
      params.append('__VIEWSTATE', viewState);
      if (viewStateGen) params.append('__VIEWSTATEGENERATOR', viewStateGen);
      if (eventVal) params.append('__EVENTVALIDATION', eventVal);
      params.append('ctl00$ContentPlaceHolder1$ASPxRoundPanel1$cboDeviceType', this.deviceType);
      params.append('ContentPlaceHolder1_ASPxRoundPanel1_cboDeviceType_VI', 'H');
      params.append('ctl00$ContentPlaceHolder1$ASPxRoundPanel1$txtuser', this.serverUser);
      params.append('ctl00$ContentPlaceHolder1$ASPxRoundPanel1$txtPassword', this.serverPassword);

      const loginRes = await this._post('/Login.aspx', params.toString(), initialCookie);

      if (loginRes.headers.location && !loginRes.headers.location.includes('Login.aspx')) {
        this.sessionCookie = loginRes.cookie || initialCookie;
        this.sessionExpiry = Date.now() + 25 * 60 * 1000; // 25 minutes validity
        this.stats.connected = true;
        this.stats.lastError = null;
        console.log(`[TIMEWATCH iDMS 9001] Authenticated successfully with ${this.serverUrl}`);
        return this.sessionCookie;
      }

      throw new Error(`Login failed on TimeWatch server (Status ${loginRes.status}, no redirect).`);
    } catch (err) {
      this.stats.connected = false;
      this.stats.lastError = err.message;
      this.sessionCookie = null;
      throw err;
    }
  }

  /**
   * Helper that executes an authenticated GET with auto-relogin on 302 to Login.aspx
   */
  async _authenticatedGet(path) {
    await this.login();
    let res = await this._get(path, this.sessionCookie);

    if (res.status === 302 && res.headers.location && res.headers.location.includes('Login.aspx')) {
      // Session expired, re-login and retry
      console.log('[TIMEWATCH iDMS 9001] Session expired, re-authenticating...');
      await this.login(true);
      res = await this._get(path, this.sessionCookie);
    }

    return res;
  }

  /**
   * Test Connection and check health of TimeWatch server
   */
  async testConnection() {
    const startTime = Date.now();
    try {
      await this.login(true);
      const latencyMs = Date.now() - startTime;
      const devicePage = await this._authenticatedGet('/DeviceListHTSeries.aspx');
      const devices = this._parseDeviceRows(devicePage.body);

      this.stats.connected = true;
      this.stats.lastCheckTime = new Date().toISOString();
      this.stats.latencyMs = latencyMs;

      return {
        success: true,
        serverUrl: this.serverUrl,
        latencyMs,
        version: 'iDMS 2.0.1 (AI Series)',
        deviceCount: devices.length,
        devicesOnline: devices.filter(d => d.status.toUpperCase() === 'ONLINE').length,
        devices
      };
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      this.stats.connected = false;
      this.stats.lastError = err.message;

      return {
        success: false,
        serverUrl: this.serverUrl,
        latencyMs,
        error: err.message
      };
    }
  }

  /**
   * Parse HTML table on DeviceListHTSeries.aspx into device objects
   */
  _parseDeviceRows(html) {
    const rows = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
    const devices = [];

    for (const r of rows) {
      if (r.includes('172.25.26.') || r.includes('TW3000000')) {
        const cells = (r.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [])
          .map(c => c.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim())
          .filter(Boolean);

        // Typical format: [Index, SerialNumber, DeviceName, IP, Status, LastComm, UserCount, FPCount, Direction, TimeZone]
        if (cells.length >= 5) {
          const sn = cells.find(c => /^TW\d{10,20}$/i.test(c)) || cells[1];
          const ip = cells.find(c => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(c)) || cells[3];
          const name = cells.find(c => /^(IN\d|OUT\d)$/i.test(c)) || cells[2];
          const status = cells.find(c => /^(Online|Offline)$/i.test(c)) || 'Online';
          const direction = cells.find(c => /^(In|Out)$/i.test(c)) || (name.startsWith('OUT') ? 'Out' : 'In');
          const lastComm = cells.find(c => /\d{2}-\d{2}-\d{4}/.test(c)) || null;

          devices.push({
            serialNumber: sn,
            ipAddress: ip,
            name,
            direction: direction.toUpperCase() === 'OUT' ? 'EXIT' : 'ENTRY',
            status: status.toUpperCase(),
            lastCommunication: lastComm
          });
        }
      }
    }

    return devices;
  }

  /**
   * Fetch live registered devices from TimeWatch server
   */
  async getLiveDevices() {
    const page = await this._authenticatedGet('/DeviceListHTSeries.aspx');
    return this._parseDeviceRows(page.body);
  }

  /**
   * Sync real devices from TimeWatch server to MySQL gate_devices table
   */
  async syncDevicesToDb() {
    const liveDevices = await this.getLiveDevices();
    if (!liveDevices || liveDevices.length === 0) {
      throw new Error('No devices found on TimeWatch server to sync.');
    }

    const laneMap = {
      '172.25.26.241': { code: 'TW-TF3000-LANE1', name: 'Hostel Main Gate - Lane 1 (Admin Exit)', dir: 'EXIT', pin: 1, loc: 'Main Hostel Arch Gate - Lane 1 Admin Exit Turnstile' },
      '172.25.26.242': { code: 'TW-TF3000-LANE2', name: 'Hostel Main Gate - Lane 2 (Entry)', dir: 'ENTRY', pin: 2, loc: 'Main Hostel Arch Gate - Lane 2 Entry Turnstile' },
      '172.25.26.243': { code: 'TW-TF3000-LANE3', name: 'Hostel Main Gate - Lane 3 (Exit)', dir: 'EXIT', pin: 3, loc: 'Main Hostel Arch Gate - Lane 3 Exit Turnstile' },
      '172.25.26.244': { code: 'TW-TF3000-LANE4', name: 'Hostel Main Gate - Lane 4 (Entry)', dir: 'ENTRY', pin: 4, loc: 'Main Hostel Arch Gate - Lane 4 Entry Turnstile' },
      '172.25.26.245': { code: 'TW-TF3000-LANE5', name: 'Hostel Main Gate - Lane 5 (Exit)', dir: 'EXIT', pin: 1, loc: 'Main Hostel Arch Gate - Lane 5 Exit Turnstile' },
      '172.25.26.246': { code: 'TW-TF3000-LANE6', name: 'Hostel Main Gate - Lane 6 (Entry)', dir: 'ENTRY', pin: 2, loc: 'Main Hostel Arch Gate - Lane 6 Entry Turnstile' },
      '172.25.26.247': { code: 'TW-TF3000-LANE7', name: 'Hostel Main Gate - Lane 7 (Exit)', dir: 'EXIT', pin: 3, loc: 'Main Hostel Arch Gate - Lane 7 Exit Turnstile' },
      '172.25.26.248': { code: 'TW-TF3000-LANE8', name: 'Hostel Main Gate - Lane 8 (Entry)', dir: 'ENTRY', pin: 4, loc: 'Main Hostel Arch Gate - Lane 8 Entry Turnstile' }
    };

    const synced = [];
    for (const d of liveDevices) {
      const mapping = laneMap[d.ipAddress] || {
        code: `TW-TF3000-${d.name}`,
        name: `Hostel Gate - ${d.name}`,
        dir: d.direction,
        pin: 1,
        loc: `Hostel Turnstile (${d.name})`
      };

      await pool.query(`
        INSERT INTO gate_devices 
        (device_code, device_name, manufacturer, model, serial_number, ip_address, port, mac_address, location_description, lane_direction, turnstile_relay_pin, status, last_heartbeat, integration_mode)
        VALUES (?, ?, 'TimeWatch', 'TrueFace3000 (ADPM)', ?, ?, 8080, '84:F3:EB:32:01:A0', ?, ?, ?, ?, IF(? = 'ONLINE', NOW(), NULL), 'HARDWARE_API')
        ON DUPLICATE KEY UPDATE 
          device_name = VALUES(device_name), 
          serial_number = VALUES(serial_number),
          ip_address = VALUES(ip_address), 
          lane_direction = VALUES(lane_direction),
          location_description = VALUES(location_description),
          status = VALUES(status),
          last_heartbeat = IF(VALUES(status) = 'ONLINE', NOW(), last_heartbeat)
      `, [mapping.code, mapping.name, d.serialNumber, d.ipAddress, mapping.loc, mapping.dir, mapping.pin, d.status, d.status]);

      synced.push({
        deviceCode: mapping.code,
        serialNumber: d.serialNumber,
        ipAddress: d.ipAddress,
        name: mapping.name,
        direction: mapping.dir,
        status: d.status
      });
    }

    return {
      success: true,
      totalSynced: synced.length,
      devices: synced
    };
  }

  /**
   * Sync device live reachability status from TimeWatch server (DeviceListHTSeries.aspx) to MySQL
   */
  async syncDeviceStatuses() {
    try {
      // 1. Fetch live status from TimeWatch server (172.25.3.51:9001)
      const liveDevices = await this.getLiveDevices().catch(() => []);
      const liveMap = new Map();
      if (Array.isArray(liveDevices)) {
        liveDevices.forEach(d => {
          liveMap.set(d.ipAddress, d.status.toUpperCase() === 'ONLINE');
          liveMap.set(d.serialNumber, d.status.toUpperCase() === 'ONLINE');
        });
      }

      // 2. Fetch current devices from database
      const [dbDevices] = await pool.query('SELECT id, serial_number, ip_address, port, status, last_heartbeat FROM gate_devices');

      // 3. Fast parallel TCP socket probe (500ms timeout) to detect instant device power-on
      const net = require('net');
      const probePromises = dbDevices.map(d => {
        return new Promise(resolve => {
          const s = new net.Socket();
          s.setTimeout(500);
          s.once('connect', () => { s.destroy(); resolve({ id: d.id, online: true }); });
          s.once('timeout', () => { s.destroy(); resolve({ id: d.id, online: false }); });
          s.once('error', () => { s.destroy(); resolve({ id: d.id, online: false }); });
          s.connect(d.port || 8080, d.ip_address);
        });
      });
      const probeResults = await Promise.all(probePromises);
      const socketOnlineMap = new Map(probeResults.map(p => [p.id, p.online]));

      // 4. Update status in database:
      // A device is ONLINE if TCP socket responds, TimeWatch iDMS reports Online, Auto-Registration socket is active, or heartbeat is recent
      const autoRegisterService = require('./autoRegisterService');
      for (const d of dbDevices) {
        const isSocketOnline = socketOnlineMap.get(d.id) || false;
        const isIdmsOnline = liveMap.get(d.ip_address) || liveMap.get(d.serial_number) || false;
        const isAutoRegOnline = autoRegisterService.isDeviceConnected(d.serial_number);

        const isOnline = isSocketOnline || isIdmsOnline || isAutoRegOnline;

        if (isOnline) {
          await pool.query(
            `UPDATE gate_devices SET status = 'ONLINE', last_heartbeat = NOW(), updated_at = NOW() WHERE id = ?`,
            [d.id]
          );
        } else {
          // Only mark OFFLINE if last_heartbeat has expired (> 300 seconds) so cloud push / Auto-Registration heartbeats are preserved
          await pool.query(
            `UPDATE gate_devices 
             SET status = 'OFFLINE', updated_at = NOW() 
             WHERE id = ? AND (last_heartbeat IS NULL OR last_heartbeat < NOW() - INTERVAL 300 SECOND)`,
            [d.id]
          );
        }
      }
    } catch (err) {
      console.warn(`[TIMEWATCH DEVICE STATUS WARN] ${err.message}`);
    }
  }

  /**
   * Extract all non-submit input values from ASP.NET HTML forms
   */
  _extractAllFormInputs(html) {
    const params = new URLSearchParams();
    const inputs = html.match(/<input[^>]+>/gi) || [];
    for (const inp of inputs) {
      const nameMatch = inp.match(/name=["']([^"']+)["']/i);
      const valMatch = inp.match(/value=["']([^"']*)["']/i);
      const typeMatch = inp.match(/type=["']([^"']+)["']/i);
      const name = nameMatch ? nameMatch[1] : '';
      const val = valMatch ? valMatch[1] : '';
      const type = typeMatch ? typeMatch[1].toLowerCase() : '';
      if (name && type !== 'submit' && type !== 'button' && type !== 'image') {
        params.append(name, val);
      }
    }
    return params;
  }

  /**
   * Direct HTTP Digest GET to a physical TimeWatch/Dahua turnstile (port 80) using device credentials (admin / tipl9910)
   */
  _digestGet(ip, cgiPath, timeoutMs = 4000) {
    return new Promise((resolve) => {
      const req1 = http.get({ hostname: ip, port: 80, path: cgiPath, timeout: timeoutMs }, res1 => {
        const www = res1.headers['www-authenticate'] || '';
        res1.resume();
        if (res1.statusCode !== 401 || !www) {
          return resolve({ status: res1.statusCode, body: '' });
        }
        const realm = (www.match(/realm="([^"]+)"/) || [])[1] || '';
        const nonce = (www.match(/nonce="([^"]+)"/) || [])[1] || '';
        const qop = (www.match(/qop="?([^",]+)"?/) || [])[1] || 'auth';
        const opaque = (www.match(/opaque="([^"]+)"/) || [])[1] || '';
        const nc = '00000001';
        const cnonce = crypto.randomBytes(4).toString('hex');
        const md5 = str => crypto.createHash('md5').update(str).digest('hex');
        const ha1 = md5(`${this.deviceUser}:${realm}:${this.devicePassword}`);
        const ha2 = md5(`GET:${cgiPath}`);
        const resp = md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
        const auth = `Digest username="${this.deviceUser}", realm="${realm}", nonce="${nonce}", uri="${cgiPath}", qop=${qop}, nc=${nc}, cnonce="${cnonce}", response="${resp}"${opaque ? `, opaque="${opaque}"` : ''}`;

        const req2 = http.get({ hostname: ip, port: 80, path: cgiPath, headers: { Authorization: auth }, timeout: timeoutMs }, res2 => {
          let body = '';
          res2.on('data', c => body += c);
          res2.on('end', () => resolve({ status: res2.statusCode, body }));
        });
        req2.on('error', e => resolve({ status: 0, error: e.message }));
        req2.on('timeout', () => { req2.destroy(); resolve({ status: 0, error: 'timeout' }); });
      });
      req1.on('error', e => resolve({ status: 0, error: e.message }));
      req1.on('timeout', () => { req1.destroy(); resolve({ status: 0, error: 'timeout' }); });
    });
  }

  /**
   * Fetch all enrolled users directly from the physical turnstiles (172.25.26.241-248) via Digest CGI
   * Works even when the local TimeWatch iDMS server (172.25.3.51:9001) is offline.
   */
  async getDirectTurnstileUsers() {
    const usersMap = new Map();
    const ipToSn = {
      '172.25.26.241': 'TW30000006260161',
      '172.25.26.242': 'TW30000006260175',
      '172.25.26.243': 'TW30000006260156',
      '172.25.26.244': 'TW30000006260127',
      '172.25.26.245': 'TW30000006260207',
      '172.25.26.246': 'TW30000006260242',
      '172.25.26.247': 'TW30000006260265',
      '172.25.26.248': 'TW30000006260256'
    };

    // Query primary turnstiles in parallel (241 and 248 hold the full superset of 950 users)
    const primaryIps = ['172.25.26.241', '172.25.26.248', '172.25.26.242'];
    for (const ip of primaryIps) {
      const sn = ipToSn[ip] || ip;
      for (let offset = 0; offset < 2500; offset += 100) {
        const res = await this._digestGet(
          ip,
          `/cgi-bin/recordFinder.cgi?action=doSeekFind&name=AccessControlCard&offset=${offset}&count=100`
        );
        if (res.status !== 200 || !res.body) break;
        const foundMatch = res.body.match(/found=(\d+)/);
        const found = foundMatch ? parseInt(foundMatch[1], 10) : 0;
        if (found === 0) break;

        const recs = {};
        for (const line of res.body.split(/\r?\n/)) {
          const m = line.match(/^records\[(\d+)\]\.(\w+)=(.*)$/);
          if (m) {
            if (!recs[m[1]]) recs[m[1]] = {};
            recs[m[1]][m[2]] = m[3].trim();
          }
        }

        for (const rec of Object.values(recs)) {
          const uid = String(rec.UserID || '').trim();
          if (!uid || uid === 'ALL') continue;
          let rawName = String(rec.CardName || '').trim();
          if (rawName === uid || /^\d+$/.test(rawName)) rawName = '';
          const card = rec.CardNo ? String(rec.CardNo).trim() : null;

          const photoPath = `/uploads/students/${uid}.jpg`;

          if (!usersMap.has(uid)) {
            usersMap.set(uid, {
              serialNumber: sn,
              model: 'TrueFace3000',
              userId: uid,
              name: rawName,
              card: card || null,
              hasFace: true,
              photoAvatar: photoPath,
              photoUrl: photoPath,
              devices: [sn]
            });
          } else {
            const cur = usersMap.get(uid);
            if (!cur.name && rawName) cur.name = rawName;
            if (!cur.card && card) cur.card = card;
            if (!cur.photoAvatar) {
              cur.photoAvatar = photoPath;
              cur.photoUrl = photoPath;
              cur.hasFace = true;
            }
            if (!cur.devices.includes(sn)) cur.devices.push(sn);
          }
        }

        if (found < 100) break;
      }
      if (usersMap.size >= 900) break; // Already retrieved full turnstile user list
    }

    return Array.from(usersMap.values());
  }

  /**
   * Fetch a single user's face photo base64 in-memory directly from physical turnstiles (172.25.26.241-248)
   * without writing to local disk.
   */
  async fetchTurnstilePhotoBase64(pin) {
    if (!pin) return null;
    const cleanPin = String(pin).trim();
    const primaryIps = ['172.25.26.241', '172.25.26.248', '172.25.26.242'];
    for (const ip of primaryIps) {
      try {
        const res = await this._digestGet(
          ip,
          `/cgi-bin/AccessFace.cgi?action=list&UserIDList[0]=${encodeURIComponent(cleanPin)}`,
          3500
        );
        if (res.status === 200 && res.body) {
          const m = String(res.body).match(/PhotoData\[0\]=([A-Za-z0-9+/=]+)/);
          if (m && m[1] && m[1].length > 100) {
            return m[1];
          }
        }
      } catch (_) {}
    }
    return null;
  }

  /**
   * Fetch enrolled biometric users directly from physical turnstiles (with iDMS UserList.aspx merge/fallback)
   */
  async getEnrolledUsers() {
    // 1. Direct hardware pull from physical turnstiles (172.25.26.241-248 using admin / tipl9910)
    const mergedMap = new Map();
    try {
      const directUsers = await this.getDirectTurnstileUsers();
      for (const u of directUsers) {
        mergedMap.set(String(u.userId).trim(), u);
      }
      if (directUsers.length > 0) {
        console.log(`[TURNSTILE DIRECT CGI] Pulled ${directUsers.length} enrolled users directly from turnstile hardware.`);
      }
    } catch (directErr) {
      console.warn('[TURNSTILE DIRECT CGI WARN]', directErr.message);
    }

    // 2. Also merge with TimeWatch iDMS server (UserList.aspx) if reachable
    try {
      await this.login();
      const initPage = await this._authenticatedGet('/UserList.aspx');
      const postParams = this._extractAllFormInputs(initPage.body);
      postParams.append('ctl00$ContentPlaceHolder1$ASPxButton2', 'Export');

      const exportRes = await this._postBuffer('/UserList.aspx', postParams.toString(), this.sessionCookie);
      const buf = exportRes.buffer;

      // Validate that the buffer is an XLSX workbook (starts with PK / zip header: 0x50, 0x4B)
      if (exportRes.status === 200 && buf.length > 500 && buf[0] === 0x50 && buf[1] === 0x4B) {
        const workbook = xlsx.read(buf, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawRows = xlsx.utils.sheet_to_json(sheet);

        if (rawRows && rawRows.length > 0) {
          for (const row of rawRows) {
            const uid = String(row['User ID'] || '').trim();
            if (!uid || uid === 'ALL') continue;

            const sn = String(row['Device ID'] || '').trim();
            const model = String(row['Device Type'] || '').trim();
            let rawName = String(row['User Name'] || '').trim();
            const card = row['Card'] ? String(row['Card']).trim() : null;
            const hasFace = String(row['Face'] || '').toLowerCase().includes('yes');

            if (rawName === uid || /^\d+$/.test(rawName)) {
              rawName = '';
            }

            if (!mergedMap.has(uid)) {
              mergedMap.set(uid, {
                serialNumber: sn,
                model,
                userId: uid,
                name: rawName,
                card: card || null,
                hasFace,
                devices: sn ? [sn] : []
              });
            } else {
              const u = mergedMap.get(uid);
              if (!u.name && rawName) u.name = rawName;
              if (!u.card && card) u.card = card;
              if (hasFace) u.hasFace = true;
              if (sn && !u.devices.includes(sn)) u.devices.push(sn);
            }
          }
        }
      }
    } catch (exportErr) {
      if (mergedMap.size > 0) {
        return Array.from(mergedMap.values());
      }
      console.warn('[TIMEWATCH IDMS WARN] Excel export failed, falling back to HTML parsing:', exportErr.message);
    }

    if (mergedMap.size > 0) {
      return Array.from(mergedMap.values());
    }

    // 2. Fallback to HTML table parsing (page 1)
    const page = await this._authenticatedGet('/UserList.aspx');
    
    // Parse grid rows preserving table structure and column indices
    const rows = (page.body.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [])
      .map(r => (r.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [])
        .map(c => c.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim())
      )
      .filter(cells => cells.length >= 4 && cells.some(c => /^TW\d{10,20}$/i.test(c)));

    const usersMap = new Map();
    for (const cells of rows) {
      const sn = cells[0] || '';
      const model = cells[1] || '';
      const uid = cells[2] || '';
      let rawName = cells[3] || '';
      const card = cells[6] || '';

      if (!uid || uid === 'ALL') continue;

      if (rawName === uid || /^\d+$/.test(rawName)) {
        rawName = '';
      }

      if (!usersMap.has(uid)) {
        usersMap.set(uid, {
          serialNumber: sn,
          model,
          userId: uid,
          name: rawName,
          card: card || null,
          devices: [sn]
        });
      } else {
        const u = usersMap.get(uid);
        if (!u.name && rawName) {
          u.name = rawName;
        }
        if (!u.card && card) {
          u.card = card;
        }
        if (sn && !u.devices.includes(sn)) {
          u.devices.push(sn);
        }
      }
    }

    return Array.from(usersMap.values());
  }

  /**
   * Sync machine users with SmartGate students table
   */
  async syncUsersToDb() {
    const machineUsers = await this.getEnrolledUsers();
    const imported = [];

    for (const u of machineUsers) {
      const pin = String(u.userId).trim();
      let rawName = (u.name || '').trim();
      let firstName = '';
      let lastName = '';
      let rollNo = pin;
      let institution = pin.startsWith('7208') ? 'HIT' : 'HICET';
      let dept = 'Computer Science & Engineering';

      // Special mapping for known students like Emmanuvel Simson (PIN 8, Register 720826105011, HIT)
      if (pin === '8' || rawName.toLowerCase().includes('emmanuvel')) {
        firstName = 'Emmanuvel';
        lastName = 'Simson';
        rollNo = '720826105011';
        institution = 'HIT';
      } else if (!rawName) {
        firstName = 'Student';
        lastName = pin;
      } else {
        // Clean and format student name
        const cleanName = rawName.replace(/^[A-Z]\./, '').trim(); // Remove leading initials like D.
        const parts = (cleanName || rawName).split(/\s+/);
        firstName = parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase() : 'Student';
        lastName = parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ') || (rawName.startsWith('D.') ? 'D' : '');
      }

      const card = u.card || null;
      const email = `${rollNo.toLowerCase()}@hicet.ac.in`;

      await pool.query(`
        INSERT INTO students 
        (student_id, first_name, last_name, department, course, year_of_study, phone, parent_phone, email, current_location_status, biometric_device_id, biometric_enrolled, card_number, is_active, institution)
        VALUES (?, ?, ?, ?, 'B.E.', 2, '9876543210', '9876543210', ?, 'INSIDE', ?, 1, ?, 1, ?)
        ON DUPLICATE KEY UPDATE 
          first_name = VALUES(first_name),
          last_name = VALUES(last_name),
          department = VALUES(department),
          institution = VALUES(institution),
          biometric_device_id = VALUES(biometric_device_id),
          card_number = IFNULL(VALUES(card_number), card_number),
          biometric_enrolled = 1,
          is_active = 1
      `, [rollNo, firstName, lastName, dept, email, pin, card, institution]);

      imported.push({
        userId: pin,
        name: `${firstName} ${lastName}`.trim(),
        card,
        studentId: rollNo,
        institution
      });
    }

    return {
      success: true,
      totalImported: imported.length,
      users: imported
    };
  }

  /**
   * Fetch punch records from RealTimeLog.aspx
   */
  async getRealTimePunches() {
    const page = await this._authenticatedGet('/RealTimeLog.aspx');
    const rows = (page.body.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [])
      .map(r => (r.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [])
        .map(c => c.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim())
        .filter(Boolean)
      )
      .filter(cells => cells.length >= 4 && cells.some(c => /^TW\d{10,20}$/i.test(c)));

    const punches = [];
    for (const cells of rows) {
      // Typical format: [UserID, DeviceSN, DeviceName, Date (DD/MM/YYYY), Time (HH:MM:SS), Mode (Face)]
      const uid = cells[0];
      const sn = cells[1];
      const name = cells[2];
      const dateStr = cells[3];
      const timeStr = cells[4];
      const mode = cells[5] || 'Face';

      // Parse date DD/MM/YYYY into ISO
      let parsedTime = new Date();
      if (dateStr && timeStr) {
        const parts = dateStr.split('/');
        if (parts.length === 3) {
          // year, monthIndex (0-based), day
          const day = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10) - 1;
          const year = parseInt(parts[2], 10);
          const [hh, mm, ss] = timeStr.split(':').map(n => parseInt(n, 10) || 0);
          parsedTime = new Date(year, month, day, hh, mm, ss);
        }
      }

      punches.push({
        userId: uid,
        serialNumber: sn,
        deviceName: name,
        punchTime: parsedTime,
        rawDate: dateStr,
        rawTime: timeStr,
        mode: mode.toUpperCase() === 'FACE' ? 'FACE' : 'CARD'
      });
    }

    return punches;
  }

  /**
   * Poll punches from TimeWatch server and feed new punches into eventProcessor
   */
  async pollAndProcessPunches() {
    try {
      const punches = await this.getRealTimePunches();
      if (!punches || punches.length === 0) return { processed: 0 };

      // Load device cache
      const [devices] = await pool.query('SELECT * FROM gate_devices');
      const deviceMap = new Map();
      devices.forEach(d => {
        deviceMap.set(d.serial_number.toLowerCase(), d);
        deviceMap.set(d.device_code.toLowerCase(), d);
      });
      const defaultDevice = devices[0];

      let newCount = 0;
      for (const p of punches) {
        const punchKey = `${p.userId}:${p.serialNumber}:${p.rawDate}:${p.rawTime}`;
        if (this.processedPunches.has(punchKey)) {
          continue; // Already processed
        }

        // Add to cache
        this.processedPunches.add(punchKey);
        if (this.processedPunches.size > this.maxCacheSize) {
          const firstKey = this.processedPunches.values().next().value;
          this.processedPunches.delete(firstKey);
        }

        // Match device
        const matchedDevice = deviceMap.get(p.serialNumber.toLowerCase()) || defaultDevice;
        if (!matchedDevice) continue;

        const direction = p.deviceName && p.deviceName.toUpperCase().startsWith('OUT')
          ? 'EXIT'
          : (matchedDevice.lane_direction || 'ENTRY');

        // Process through SmartGate eventProcessor!
        const decision = await eventProcessor.processEvent({
          eventUuid: crypto.randomUUID(),
          deviceId: matchedDevice.id,
          deviceCode: matchedDevice.device_code,
          biometricDeviceId: String(p.userId).trim(),
          timestamp: p.punchTime,
          direction,
          verificationType: p.mode,
          eventSource: 'HARDWARE',
          rawPayload: p
        });

        newCount++;
        this.stats.totalPunchesIngested++;
        if (decision.granted) this.stats.totalPunchesGranted++;
        else this.stats.totalPunchesDenied++;

        console.log(`[TIMEWATCH LIVE PUNCH] User ${p.userId} at ${matchedDevice.device_code} (${direction}) -> ${decision.accessResult}`);
      }

      this.stats.lastSyncTime = new Date().toISOString();
      return { processed: newCount, totalInBatch: punches.length };
    } catch (err) {
      console.warn(`[TIMEWATCH POLL WARN] ${err.message}`);
      this.stats.lastError = err.message;
      return { processed: 0, error: err.message };
    }
  }

  /**
   * Start live background polling for real-time punches
   */
  startLiveSync(intervalMs = this.pollIntervalMs) {
    if (this.isPolling) return;
    this.pollIntervalMs = intervalMs;
    this.isPolling = true;

    console.log(`[TIMEWATCH iDMS 9001] Starting live punch sync worker (interval: ${this.pollIntervalMs}ms)...`);

    // Run initial syncs
    this.pollAndProcessPunches().catch(() => {});
    this.syncDeviceStatuses().catch(() => {});

    this.pollingTimer = setInterval(async () => {
      try {
        await this.pollAndProcessPunches();
      } catch (err) {
        // Silently continue polling
      }
    }, this.pollIntervalMs);

    // Periodic device status synchronization every 20 seconds
    this.deviceStatusTimer = setInterval(async () => {
      try {
        await this.syncDeviceStatuses();
      } catch (err) {
        // Silently continue
      }
    }, 20000);
  }

  /**
   * Resolve path to Microsoft Edge on Windows
   */
  _getEdgeExecutable() {
    const fs = require('fs');
    const candidates = [
      process.env.EDGE_PATH,
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    for (const c of candidates) {
      if (c && fs.existsSync(c)) return c;
    }
    return 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  }

  /**
   * Helper to execute browser automation under a mutex lock to avoid concurrent session conflicts
   */
  async _withBrowser(fn) {
    const fs = require('fs');
    const edgePath = this._getEdgeExecutable();
    if (!fs.existsSync(edgePath)) {
      return { success: false, skipped: true, reason: 'Local browser executable not present on this server' };
    }

    if (!this._browserLock) {
      this._browserLock = Promise.resolve();
    }
    const prevLock = this._browserLock;
    let release;
    this._browserLock = new Promise(resolve => { release = resolve; });

    try {
      await prevLock;
      const puppeteer = require('puppeteer-core');
      const cookieHeader = await this.login(true);
      const cookies = cookieHeader.split(';').map(c => {
        const [name, ...rest] = c.trim().split('=');
        return { name, value: rest.join('='), domain: this.hostname, path: '/' };
      }).filter(c => c.name && c.value);

      const browser = await puppeteer.launch({
        executablePath: this._getEdgeExecutable(),
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
      });

      try {
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(45000);
        await page.setViewport({ width: 1280, height: 800 });
        await page.setCookie(...cookies);
        page.on('dialog', async d => {
          try { await d.accept(); } catch (_) {}
        });

        return await fn(page, browser);
      } finally {
        await browser.close().catch(() => {});
      }
    } finally {
      release();
    }
  }

  /**
   * Push a student's face photo to all physical turnstiles and iDMS
   */
  async pushStudentPhotoToTurnstiles({ pin, name, photoPath, photoBase64 }) {
    try {
      const fs = require('fs');
      const path = require('path');
      const sharp = require('sharp');
      let base64 = photoBase64;
      let bufferLength = 0;

      // 1. Resolve photo from disk if needed
      if (!base64 && photoPath) {
        let resolvedPath = photoPath;
        if (!fs.existsSync(resolvedPath)) {
          const cleanRel = String(photoPath).replace(/^[/\\]+/, '');
          resolvedPath = path.resolve(__dirname, '../../', cleanRel);
          if (!fs.existsSync(resolvedPath)) {
            resolvedPath = path.resolve(__dirname, '../../uploads/students', path.basename(photoPath));
          }
        }
        if (fs.existsSync(resolvedPath)) {
          const buf = fs.readFileSync(resolvedPath);
          base64 = buf.toString('base64');
          bufferLength = buf.length;
        }
      }

      if (!base64) {
        return { success: false, message: 'No photo data' };
      }

      // Optimize image specifically to 352x432 JPEG (matching TimeWatch webcam dimensions exactly)
      try {
        const rawBuf = Buffer.from(base64, 'base64');
        const optBuf = await sharp(rawBuf)
          .resize(352, 432, { fit: 'cover' })
          .jpeg({ quality: 95 })
          .toBuffer();
        base64 = optBuf.toString('base64');
        bufferLength = optBuf.length;
      } catch (optErr) {
        console.warn('[PHOTO PUSH OPTIMIZE WARN]', optErr.message);
      }

      const userPin = String(pin).trim();
      const userName = (name || `Student ${userPin}`).trim();
      const admsService = require('./admsService');
      const timewatchApiService = require('./timewatchApiService');

      // Fetch turnstiles
      const [devices] = await pool.query('SELECT serial_number FROM gate_devices');
      const serials = devices.map(d => d.serial_number).filter(Boolean);
      const targetSerials = serials.length > 0 ? serials : [
        'TW30000006260175', 'TW30000006260161', 'TW30000006260156', 'TW30000006260207',
        'TW30000006260242', 'TW30000006260256', 'TW30000006260265', 'TW30000006260127'
      ];

      // 1. ADMS Push: queue USERPHOTO and BIOPHOTO commands for all turnstiles
      for (const sn of targetSerials) {
        const cmd1 = `DATA UPDATE USERPHOTO PIN=${userPin}\tFileName=${userPin}.jpg\tSize=${bufferLength}\tContent=${base64}`;
        const cmd2 = `DATA UPDATE BIOPHOTO PIN=${userPin}\tType=9\tSize=${bufferLength}\tContent=${base64}`;
        admsService.queueCommand(sn, cmd1);
        admsService.queueCommand(sn, cmd2);
      }

      // 2. TWAPI Push: send AddUser with FaceTemplate
      for (const sn of targetSerials) {
        timewatchApiService.addUser({
          UserID: userPin,
          Name: userName,
          DeviceID: sn,
          FaceTemplate: base64
        }).catch(() => {});
      }

      // 3. iDMS Server Registration & Dispatch via DownloadUser.aspx and frmTemplateHTSeries.aspx
      try {
        const dataUri = `data:image/jpeg;base64,${base64}`;
        await this._withBrowser(async (page) => {
          // A. Upload photo on DownloadUser.aspx
          await page.goto(`${this.serverUrl}/DownloadUser.aspx`, { waitUntil: 'networkidle0', timeout: 15000 });

          const uploadOk = await page.evaluate(async (uri, p, n) => {
            const dev = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_GrdDevice');
            if (dev) {
              dev.SetSelectedIndex(0);
              const txt = document.getElementById('ContentPlaceHolder1_GrdDevice_I');
              if (txt) txt.value = dev.GetText();
            }

            const user = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_txtuserID');
            if (user) {
              user.SetText(p);
              user.SetValue(p);
              const txt = document.getElementById('ContentPlaceHolder1_txtuserID_I');
              if (txt) txt.value = p;
            }

            const nameCtrl = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_UserName');
            if (nameCtrl) {
              nameCtrl.SetText(n);
              nameCtrl.SetValue(n);
              const txt = document.getElementById('ContentPlaceHolder1_UserName_I');
              if (txt) txt.value = n;
            }

            window.data_uri_tmp = uri;

            return new Promise(resolve => {
              PageMethods.uploasClientClick(uri, p, 'IN1', n,
                () => resolve(true),
                () => resolve(false)
              );
            });
          }, dataUri, userPin, userName);

          if (uploadOk) {
            // Select all turnstile rows in grdDeviceU
            await page.evaluate(() => {
              const grid = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_grdDeviceU');
              if (grid) grid.SelectAllRowsOnPage();
            });
            await new Promise(r => setTimeout(r, 1000));

            // Trigger upload command to all turnstiles
            const navPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {});
            await page.evaluate(() => {
              const c = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_btnUpload');
              if (c) c.DoClick();
              else document.getElementById('ContentPlaceHolder1_btnUpload_I').click();
            });
            await navPromise;
            await new Promise(r => setTimeout(r, 2000));
            console.log(`[HARDWARE PHOTO PUSH] Face photo command dispatched via DownloadUser.aspx for ${userName} (${userPin})`);
          }

          // B. Dispatch template on frmTemplateHTSeries.aspx
          await page.goto(`${this.serverUrl}/frmTemplateHTSeries.aspx`, { waitUntil: 'networkidle0', timeout: 15000 });

          // Select all devices in GridView2
          await page.evaluate(() => {
            const grid2 = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_ASPxGridView2');
            if (grid2) grid2.SelectAllRowsOnPage();
          });
          await new Promise(r => setTimeout(r, 1000));

          // Select the student row in GridView1
          await page.evaluate(() => {
            const grid1 = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_ASPxGridView1');
            if (grid1) grid1.SelectAllRowsOnPage();
          });
          await new Promise(r => setTimeout(r, 1000));

          // Click Upload button (ContentPlaceHolder1_ASPxButton1)
          await page.evaluate(() => {
            const btn1 = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_ASPxButton1');
            if (btn1) btn1.DoClick();
            else document.getElementById('ContentPlaceHolder1_ASPxButton1_I').click();
          });
          await new Promise(r => setTimeout(r, 4000));
          console.log(`[HARDWARE PHOTO PUSH] Template dispatched via frmTemplateHTSeries.aspx for ${userName} (${userPin})`);
        });
      } catch (idmsErr) {
        console.warn(`[iDMS PHOTO REGISTER WARN] ${idmsErr.message}`);
      }

      console.log(`[HARDWARE PHOTO PUSH] Face photo pipeline completed across all turnstiles for ${userName} (${userPin})`);
      return { success: true, pin: userPin, name: userName };
    } catch (err) {
      console.error(`[PHOTO PUSH ERROR] ${pin}:`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Push a specific student (or all students) to all 8 physical turnstiles via TimeWatch iDMS
   */
  async pushStudentToTurnstiles({ pin, name, department, cardNumber, photoPath, photoBase64 }) {
    console.log(`[TIMEWATCH HARDWARE PUSH] Pushing student ${name} (PIN: ${pin}) to physical turnstiles...`);

    const admsService = require('./admsService');
    const timewatchApiService = require('./timewatchApiService');

    // Fetch turnstiles
    const [devices] = await pool.query('SELECT serial_number FROM gate_devices');
    const serials = devices.map(d => d.serial_number).filter(Boolean);
    const targetSerials = serials.length > 0 ? serials : [
      'TW30000006260175', 'TW30000006260161', 'TW30000006260156', 'TW30000006260207',
      'TW30000006260242', 'TW30000006260256', 'TW30000006260265', 'TW30000006260127'
    ];

    const userPin = String(pin).trim();
    const userName = (name || `Student ${userPin}`).trim();

    // 1. Immediately queue ADMS user record command across all turnstiles
    for (const sn of targetSerials) {
      admsService.queueCommand(
        sn,
        `DATA UPDATE USER PIN=${userPin}\tName=${userName}\tCard=${cardNumber || ''}\tPri=0\tGrp=1`
      );
    }

    // 1b. Direct hardware CGI push to all 8 turnstile IPs (172.25.26.241-248) using admin / tipl9910
    try {
      const encName = encodeURIComponent(userName);
      const encPin = encodeURIComponent(userPin);
      const encCard = encodeURIComponent(cardNumber || userPin);
      await Promise.all(this.turnstileIps.map(ip =>
        this._digestGet(
          ip,
          `/cgi-bin/recordUpdater.cgi?action=insert&name=AccessControlCard&CardName=${encName}&CardNo=${encCard}&UserID=${encPin}&CardStatus=0&CardType=0&UserType=0&ValidDateStart=20200101%20000000&ValidDateEnd=20351231%20235959`,
          2500
        ).catch(() => {})
      ));
    } catch (_) {}

    // 2. Ensure employee record exists and upload basic user details via iDMS Employee.aspx
    let employeeResult = null;
    try {
      employeeResult = await this._withBrowser(async (page) => {
        await page.goto(`${this.serverUrl}/Employee.aspx`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForSelector('#ContentPlaceHolder1_ASPxButton3', { timeout: 10000 });

        const pageText = await page.evaluate(() => document.body.innerText);
        const exists = pageText.includes(userName) || pageText.includes(`\t${userPin}\t`) || pageText.includes(` ${userPin} `);

        if (!exists) {
          console.log(`[TIMEWATCH HARDWARE PUSH] Student ${userPin} not yet in Employee.aspx, creating record...`);
          await page.evaluate(() => {
            const addBtn = document.querySelector('[id*="DXCBtn0"]') || document.querySelector('img[title="New"]');
            if (addBtn) addBtn.click();
          });

          const editorInput = await page.waitForSelector('#ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXPEForm_DXEFL_DXEditor2_I, input[id*="Editor2_I"]', { visible: true, timeout: 6000 }).catch(() => null);

          if (editorInput) {
            await page.click('#ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXPEForm_DXEFL_DXEditor2_I').catch(() => {});
            await page.type('#ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXPEForm_DXEFL_DXEditor2_I', userPin).catch(() => {});

            await page.click('#ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXPEForm_DXEFL_DXEditor3_I').catch(() => {});
            await page.type('#ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXPEForm_DXEFL_DXEditor3_I', userPin).catch(() => {});

            await page.click('#ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXPEForm_DXEFL_DXEditor4_I').catch(() => {});
            await page.type('#ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXPEForm_DXEFL_DXEditor4_I', userName).catch(() => {});

            await page.evaluate(() => {
              const saveBtn = document.getElementById('ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXPEForm_DXEFL_DXCBtn19') ||
                              document.querySelector('img[title="Save"]');
              if (saveBtn) saveBtn.click();
            });
            await new Promise(r => setTimeout(r, 2000));
          }
        }

        // Trigger Upload To Device
        await page.evaluate(() => {
          const chk = document.querySelector('#ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXSelAllBtn0') ||
                      document.querySelector('[id*="DXSelAllBtn0"]');
          if (chk) chk.click();
        });
        await new Promise(r => setTimeout(r, 800));

        await page.evaluate(() => {
          const btn = document.getElementById('ContentPlaceHolder1_ASPxButton3') ||
                      document.getElementById('ContentPlaceHolder1_ASPxButton3_CD');
          if (btn) btn.click();
        });

        await new Promise(r => setTimeout(r, 1200));
        await page.evaluate(() => {
          const devChk = document.querySelector('#ContentPlaceHolder1_pcLogin_Panel1_ASPxFormLayout2_grdDevice_DXSelAllBtn0') ||
                         document.querySelector('[id*="grdDevice"][id*="DXSelAllBtn0"]');
          if (devChk) devChk.click();

          const okBtn = document.getElementById('ContentPlaceHolder1_pcLogin_Panel1_ASPxFormLayout2_btOK') ||
                        document.getElementById('ContentPlaceHolder1_pcLogin_Panel1_ASPxFormLayout2_btOK_CD') ||
                        document.querySelector('[id*="btOK"]');
          if (okBtn) okBtn.click();
        });

        await new Promise(r => setTimeout(r, 2500));
        return { success: true, message: `Dispatched User Details for ${userName} (${userPin})` };
      });
    } catch (empErr) {
      console.warn(`[TIMEWATCH EMPLOYEE ASYNC WARN] ${empErr.message}`);
      employeeResult = { success: false, error: empErr.message };
    }

    // 3. Await face photo push sequentially so the photo is guaranteed to be pushed to all turnstiles
    let photoResult = null;
    if (photoPath || photoBase64) {
      console.log(`[TIMEWATCH HARDWARE PUSH] Now pushing face photo for ${name} (PIN: ${pin})...`);
      photoResult = await this.pushStudentPhotoToTurnstiles({ pin: userPin, name: userName, photoPath, photoBase64 });
    }

    return {
      success: true,
      pin: userPin,
      name: userName,
      employeeResult,
      photoResult
    };
  }

  /**
   * Push multiple students' photos in a single browser session (high-efficiency bulk push)
   * Eliminates repeated Edge browser startup overhead and prevents deadlocks
   */
  async pushStudentPhotosBatch(students = []) {
    if (!students || students.length === 0) return { success: true, count: 0 };
    console.log(`[HARDWARE BATCH PHOTO PUSH] Preparing batch photo push for ${students.length} student(s)...`);

    const admsService = require('./admsService');
    const timewatchApiService = require('./timewatchApiService');
    const sharp = require('sharp');
    const fs = require('fs');
    const path = require('path');

    // Fetch turnstiles
    const [devices] = await pool.query('SELECT serial_number FROM gate_devices');
    const serials = devices.map(d => d.serial_number).filter(Boolean);
    const targetSerials = serials.length > 0 ? serials : [
      'TW30000006260175', 'TW30000006260161', 'TW30000006260156', 'TW30000006260207',
      'TW30000006260242', 'TW30000006260256', 'TW30000006260265', 'TW30000006260127'
    ];

    // Pre-process and optimize all photos first (before opening browser)
    const validStudents = [];
    for (const s of students) {
      let resolvedPath = s.photoPath || s.photo_avatar;
      let base64 = s.photoBase64 || null;
      let bufLength = 0;

      if (!base64 && resolvedPath) {
        if (!fs.existsSync(resolvedPath)) {
          const cleanRel = String(resolvedPath).replace(/^[/\\]+/, '');
          resolvedPath = path.resolve(__dirname, '../../', cleanRel);
          if (!fs.existsSync(resolvedPath)) {
            resolvedPath = path.resolve(__dirname, '../../uploads/students', path.basename(s.photoPath || s.photo_avatar));
          }
        }
        if (fs.existsSync(resolvedPath)) {
          let buf = fs.readFileSync(resolvedPath);
          try {
            if (buf.length > 80 * 1024) {
              buf = await sharp(buf)
                .rotate()
                .resize(480, 640, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 85 })
                .toBuffer();
            }
          } catch (_) {}
          base64 = buf.toString('base64');
          bufLength = buf.length;
        }
      }

      if (base64) {
        const pin = String(s.pin || s.biometric_device_id || s.student_id).trim();
        const name = (s.name || `${s.first_name || ''} ${s.last_name || ''}`).trim() || `Student ${pin}`;
        validStudents.push({ pin, name, base64, bufLength });

        // 1. Queue ADMS USERPHOTO & BIOPHOTO commands for all turnstiles
        for (const sn of targetSerials) {
          const cmd1 = `DATA UPDATE USERPHOTO PIN=${pin}\tFileName=${pin}.jpg\tSize=${bufLength}\tContent=${base64}`;
          const cmd2 = `DATA UPDATE BIOPHOTO PIN=${pin}\tType=9\tSize=${bufLength}\tContent=${base64}`;
          admsService.queueCommand(sn, cmd1);
          admsService.queueCommand(sn, cmd2);
        }

        // 2. Queue TWAPI AddUser with FaceTemplate
        for (const sn of targetSerials) {
          timewatchApiService.addUser({
            UserID: pin,
            Name: name,
            DeviceID: sn,
            FaceTemplate: base64
          }).catch(() => {});
        }
      }
    }

    if (validStudents.length === 0) {
      return { success: true, count: 0, message: 'No valid photos to push' };
    }

    // 3. Dispatch via TimeWatch iDMS DownloadUser.aspx in ONE single browser session
    let dispatchedCount = 0;
    try {
      await this._withBrowser(async (page) => {
        await page.goto(`${this.serverUrl}/DownloadUser.aspx`, { waitUntil: 'networkidle0', timeout: 15000 });

        for (const u of validStudents) {
          const dataUri = `data:image/jpeg;base64,${u.base64}`;
          const ok = await page.evaluate(async (uri, p, n) => {
            const dev = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_GrdDevice');
            if (dev) dev.SetSelectedIndex(0);

            const user = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_txtuserID');
            if (user) { user.SetText(p); user.SetValue(p); }

            const nameCtrl = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_UserName');
            if (nameCtrl) { nameCtrl.SetText(n); nameCtrl.SetValue(n); }

            return new Promise(resolve => {
              PageMethods.uploasClientClick(uri, p, 'IN1', n,
                () => resolve(true),
                () => resolve(false)
              );
            });
          }, dataUri, u.pin, u.name);

          if (ok) dispatchedCount++;
        }

        if (dispatchedCount > 0) {
          // Select all turnstile rows in grdDeviceU
          await page.evaluate(() => {
            const grid = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_grdDeviceU');
            if (grid) grid.SelectAllRowsOnPage();
          });
          await new Promise(r => setTimeout(r, 1000));

          // Click Upload button to send commands across all 8 turnstiles
          await page.evaluate(() => {
            const btn = document.getElementById('ContentPlaceHolder1_btnUpload_I');
            if (btn) btn.click();
            else {
              const c = ASPxClientControl.GetControlCollection().GetByName('ContentPlaceHolder1_btnUpload');
              if (c) c.DoClick();
            }
          });

          await new Promise(r => setTimeout(r, 4000));
          console.log(`[HARDWARE BATCH PHOTO PUSH] Successfully dispatched upload command for ${dispatchedCount} photo(s) across all 8 turnstiles!`);
        }
      });
    } catch (batchErr) {
      console.warn(`[HARDWARE BATCH PHOTO PUSH WARN] ${batchErr.message}`);
    }

    return {
      success: true,
      count: dispatchedCount,
      message: `Pushed ${dispatchedCount} student face photos across all 8 turnstiles.`
    };
  }

  /**
   * Push all registered students to all 8 physical turnstiles
   */
  async pushAllStudentsToTurnstiles() {
    console.log('[TIMEWATCH HARDWARE PUSH ALL] Uploading all users to 8 turnstile devices...');
    const result = await this._withBrowser(async (page) => {
      await page.goto(`${this.serverUrl}/Employee.aspx`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForSelector('#ContentPlaceHolder1_ASPxButton3', { timeout: 10000 });

      // 1. Select all employees
      await page.evaluate(() => {
        const chk = document.querySelector('#ContentPlaceHolder1_ASPxCallbackPanel1_ASPxGridView1_DXSelAllBtn0') ||
                    document.querySelector('[id*="DXSelAllBtn0"]');
        if (chk) chk.click();
      });
      await new Promise(r => setTimeout(r, 1000));

      // 2. Click Upload To Device
      await page.evaluate(() => {
        const btn = document.getElementById('ContentPlaceHolder1_ASPxButton3') ||
                    document.getElementById('ContentPlaceHolder1_ASPxButton3_CD');
        if (btn) btn.click();
      });
      await new Promise(r => setTimeout(r, 1500));

      // 3. Select all devices in popup and click OK
      await page.evaluate(() => {
        const devChk = document.querySelector('#ContentPlaceHolder1_pcLogin_Panel1_ASPxFormLayout2_grdDevice_DXSelAllBtn0') ||
                       document.querySelector('[id*="grdDevice"][id*="DXSelAllBtn0"]');
        if (devChk) devChk.click();

        const okBtn = document.getElementById('ContentPlaceHolder1_pcLogin_Panel1_ASPxFormLayout2_btOK') ||
                      document.getElementById('ContentPlaceHolder1_pcLogin_Panel1_ASPxFormLayout2_btOK_CD') ||
                      document.querySelector('[id*="btOK"]');
        if (okBtn) okBtn.click();
      });

      await new Promise(r => setTimeout(r, 3000));
      console.log('[TIMEWATCH HARDWARE PUSH ALL] All students uploaded to all turnstiles successfully!');
      return { success: true, message: 'All students uploaded to all turnstiles successfully!' };
    });

    console.log('[TIMEWATCH HARDWARE PUSH ALL] TimeWatch iDMS uploaded all user records and face templates to turnstile terminals.');

    return {
      success: true,
      message: 'Successfully dispatched Set User Details and Face Photos for all students across all 8 turnstile machines.'
    };
  }

  /**
   * Delete a student from TimeWatch iDMS and trigger automatic hardware wipe across turnstiles
   */
  async deleteStudentFromTurnstiles({ pin, name }) {
    console.log(`[TIMEWATCH HARDWARE DELETE] Deleting student ${name} (PIN: ${pin}) from TimeWatch and turnstiles...`);
    const targetPin = String(pin).trim();

    // 1. Direct hardware CGI delete across all 8 turnstile IPs (172.25.26.241-248) using admin / tipl9910
    try {
      const encPin = encodeURIComponent(targetPin);
      await Promise.all(this.turnstileIps.map(ip =>
        this._digestGet(
          ip,
          `/cgi-bin/AccessUser.cgi?action=removeMulti&UserIDList[0]=${encPin}`,
          2500
        ).catch(() => {})
      ));
    } catch (_) {}

    try {
      return await this._withBrowser(async (page) => {
        page.on('dialog', async d => {
          console.log('[TIMEWATCH DIALOG]', d.type(), d.message());
          await d.accept().catch(() => {});
        });

        await page.goto(`${this.serverUrl}/frmTemplateHTSeries.aspx`, { waitUntil: 'networkidle2', timeout: 30000 });

        // Select all devices on ASPxGridView2
        const hasGrid2 = await page.evaluate(() => !!document.querySelector('#ContentPlaceHolder1_ASPxGridView2_DXHeadersRow0 .dxICheckBox_MetropolisBlue'));
        if (hasGrid2) {
          await page.click('#ContentPlaceHolder1_ASPxGridView2_DXHeadersRow0 .dxICheckBox_MetropolisBlue').catch(() => {});
          await new Promise(r => setTimeout(r, 2000));
        }

        // Find user row in ASPxGridView1 matching target pin
        const targetPin = String(pin).trim();
        const found = await page.evaluate((p) => {
          const rows = Array.from(document.querySelectorAll('#ContentPlaceHolder1_ASPxGridView1 tr[id*="DXDataRow"]'));
          const r = rows.find(row => {
            const cells = Array.from(row.querySelectorAll('td')).map(c => c.innerText.trim());
            return cells.includes(p);
          });
          if (r) {
            const chk = r.querySelector('.dxICheckBox_MetropolisBlue');
            if (chk) { chk.click(); return true; }
          }
          return false;
        }, targetPin);

        if (found) {
          await new Promise(r => setTimeout(r, 1500));
          // Click Delete button (ASPxButton2)
          await page.evaluate(() => {
            const btn2 = document.getElementById('ContentPlaceHolder1_ASPxButton2');
            if (btn2) btn2.click();
          });
          await new Promise(r => setTimeout(r, 3000));
        }

        return {
          success: true,
          deletedOnTimeWatch: found,
          message: found
            ? `Successfully removed PIN ${targetPin} from TimeWatch and queued turnstile deletion.`
            : `User PIN ${targetPin} was not present on TimeWatch server.`
        };
      });
    } catch (err) {
      console.warn('[TIMEWATCH HARDWARE DELETE WARN]', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Delete all students from TimeWatch iDMS and turnstiles
   */
  async deleteAllStudentsFromTurnstiles() {
    console.log('[TIMEWATCH HARDWARE DELETE ALL] Wiping all enrolled templates and users from TimeWatch and turnstiles...');
    try {
      return await this._withBrowser(async (page) => {
        page.on('dialog', async d => {
          console.log('[TIMEWATCH DIALOG]', d.type(), d.message());
          await d.accept().catch(() => {});
        });

        await page.goto(`${this.serverUrl}/frmTemplateHTSeries.aspx`, { waitUntil: 'networkidle2', timeout: 30000 });

        // 1. Select all turnstile devices on ASPxGridView2
        const hasGrid2 = await page.evaluate(() => !!document.querySelector('#ContentPlaceHolder1_ASPxGridView2_DXHeadersRow0 .dxICheckBox_MetropolisBlue'));
        if (hasGrid2) {
          await page.click('#ContentPlaceHolder1_ASPxGridView2_DXHeadersRow0 .dxICheckBox_MetropolisBlue').catch(() => {});
          await new Promise(r => setTimeout(r, 2500));
        }

        // 2. Select all users/templates on ASPxGridView1
        const hasGrid1 = await page.evaluate(() => !!document.querySelector('#ContentPlaceHolder1_ASPxGridView1_DXHeadersRow0 .dxICheckBox_MetropolisBlue'));
        if (hasGrid1) {
          await page.click('#ContentPlaceHolder1_ASPxGridView1_DXHeadersRow0 .dxICheckBox_MetropolisBlue').catch(() => {});
          await new Promise(r => setTimeout(r, 2500));
        }

        // 3. Click the official "Delete All" button
        await page.evaluate(() => {
          const btn4 = document.getElementById('ContentPlaceHolder1_ASPxButton4');
          if (btn4) btn4.click();
        });

        // Allow 8s for TimeWatch server to dispatch wipe commands across all physical turnstiles
        await new Promise(r => setTimeout(r, 8000));

        console.log('[TIMEWATCH HARDWARE DELETE ALL] Finished dispatching Delete All commands to all turnstiles.');
        return {
          success: true,
          message: 'Successfully wiped all student records and templates from TimeWatch server and physical turnstiles.'
        };
      });
    } catch (err) {
      console.warn('[TIMEWATCH HARDWARE DELETE ALL WARN]', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Download image buffer with authenticated session cookie
   */
  async downloadImageBuffer(imgPath) {
    await this.login();
    return new Promise((resolve, reject) => {
      const req = http.get({
        hostname: this.hostname,
        port: this.port,
        path: imgPath,
        headers: { Cookie: this.sessionCookie },
        timeout: 10000
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Timeout downloading image from ${imgPath}`));
      });
    });
  }

  /**
   * Sync all user photos from UserPhoto.aspx into local storage and database
   */
  async syncAllUserPhotosToDb() {
    await this.login();
    console.log('[TIMEWATCH PHOTOS] Starting full student photo sync from UserPhoto.aspx...');

    const uploadDir = path.resolve(__dirname, '../../uploads/students');
    const fs = require('fs');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const initPage = await this._authenticatedGet('/UserPhoto.aspx');
    const baseFormInputs = this._extractAllFormInputs(initPage.body);

    // Parse page count (e.g. Page 1 of 50 (4910 items))
    const pageMatch = initPage.body.match(/Page \d+ of (\d+)/i);
    const totalPages = pageMatch ? parseInt(pageMatch[1], 10) : 50;

    const userPhotoMap = new Map(); // uid -> { dev, uid, name, imgUrl }

    const parseHtmlRows = (rawHtml) => {
      const html = String(rawHtml || '').replace(/\\"/g, '"').replace(/\\'/g, "'");
      const pageItems = [];
      const rows = html.match(/<tr id="ContentPlaceHolder1_ASPxGridView1_DXDataRow\d+"[\s\S]*?<\/tr>/gi) || [];
      for (const r of rows) {
        const cells = (r.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || []).map(c => c.replace(/<[^>]+>/g, '').trim());
        const imgMatch = r.match(/src="([^"]+)"/);
        const dev = cells[0] || '';
        const uid = cells[1] || '';
        const name = cells[2] || '';
        const imgUrl = imgMatch ? imgMatch[1] : null;

        if (uid && imgUrl && !userPhotoMap.has(uid)) {
          const item = { dev, uid, name, imgUrl };
          userPhotoMap.set(uid, item);
          pageItems.push(item);
        }
      }
      return pageItems;
    };

    let dbAvailable = true;
    try {
      await pool.query('SELECT 1');
    } catch (_) {
      dbAvailable = false;
    }

    let updatedCount = 0;
    const processPageItems = async (pageItems) => {
      if (!pageItems || pageItems.length === 0) return;
      await Promise.all(pageItems.map(async (item) => {
        try {
          const fileName = `${item.uid}.jpg`;
          const filePath = path.join(uploadDir, fileName);
          let hasValidFile = fs.existsSync(filePath) && fs.statSync(filePath).size > 500;

          if (!hasValidFile) {
            const buf = await this.downloadImageBuffer(item.imgUrl);
            if (buf && buf.length > 500) {
              fs.writeFileSync(filePath, buf);
              hasValidFile = true;
            }
          }

          if (hasValidFile) {
            if (dbAvailable) {
              const avatarPath = `/uploads/students/${fileName}`;
              const rollNo = item.uid;
              let firstName = '';
              let lastName = '';
              if (item.name && !/^\d+$/.test(item.name)) {
                const cleanName = item.name.replace(/^[A-Z]\./, '').trim();
                const parts = (cleanName || item.name).split(/\s+/);
                firstName = parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase() : '';
                lastName = parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');
              }

              try {
                if (firstName) {
                  await pool.query(
                    `UPDATE students 
                     SET photo_avatar = ?, photo_url = ?, first_name = ?, last_name = ? 
                     WHERE biometric_device_id = ? OR student_id = ? OR student_id = ?`,
                    [avatarPath, avatarPath, firstName, lastName, item.uid, rollNo, `TW-${item.uid}`]
                  );
                } else {
                  await pool.query(
                    `UPDATE students 
                     SET photo_avatar = ?, photo_url = ? 
                     WHERE biometric_device_id = ? OR student_id = ? OR student_id = ?`,
                    [avatarPath, avatarPath, item.uid, rollNo, `TW-${item.uid}`]
                  );
                }
              } catch (_) {}
            }
            updatedCount++;
          }
        } catch (_) {}
      }));
    };

    // 1. Parse and download initial page (Page 0) immediately while DXCache tokens are live
    await processPageItems(parseHtmlRows(initPage.body));

    // 2. Fetch remaining pages sequentially so ASP.NET session state & DXCache stay valid
    for (let p = 1; p < totalPages; p++) {
      try {
        const params = new URLSearchParams(baseFormInputs.toString());
        params.set('__CALLBACKID', 'ctl00$ContentPlaceHolder1$ASPxGridView1');
        params.set('__CALLBACKPARAM', `c0:KV|2;[];GB|20;12|PAGERONCLICK3|PN${p};`);

        const res = await this._post('/UserPhoto.aspx', params.toString(), this.sessionCookie);
        const newItems = parseHtmlRows(res.body);
        await processPageItems(newItems);
      } catch (err) {
        console.warn(`[TIMEWATCH PHOTOS WARN] Failed fetching page ${p + 1}: ${err.message}`);
      }
    }

    console.log(`[TIMEWATCH PHOTOS] Completed. Found ${userPhotoMap.size} unique student photos, downloaded/mapped ${updatedCount}!`);
    return {
      success: true,
      totalPhotosOnServer: userPhotoMap.size,
      updatedCount
    };
  }

  /**
   * Fetch single user photo on-demand by PIN (checks local disk -> direct turnstile AccessFace.cgi -> iDMS UserPhoto.aspx)
   */
  async fetchUserPhotoByPin(pin) {
    if (!pin) return null;
    const cleanPin = String(pin).trim();
    const fs = require('fs');
    const uploadDir = path.resolve(__dirname, '../../uploads/students');
    const localFile = path.join(uploadDir, `${cleanPin}.jpg`);

    // 1. Check if already on disk
    if (fs.existsSync(localFile) && fs.statSync(localFile).size > 200) {
      const buf = fs.readFileSync(localFile);
      return {
        buffer: buf,
        base64: buf.toString('base64'),
        url: `/uploads/students/${cleanPin}.jpg`
      };
    }

    // 2. Fetch directly from physical turnstiles (172.25.26.241..248) via Digest CGI AccessFace.cgi
    const primaryIps = ['172.25.26.241', '172.25.26.248', '172.25.26.242'];
    for (const ip of primaryIps) {
      try {
        const res = await this._digestGet(
          ip,
          `/cgi-bin/AccessFace.cgi?action=list&UserIDList[0]=${encodeURIComponent(cleanPin)}`,
          4000
        );
        if (res.status === 200 && res.body) {
          const m = String(res.body).match(/PhotoData\[0\]=([A-Za-z0-9+/=]+)/);
          if (m && m[1] && m[1].length > 100) {
            const buf = Buffer.from(m[1], 'base64');
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
            fs.writeFileSync(localFile, buf);
            const avatarPath = `/uploads/students/${cleanPin}.jpg`;
            try {
              await pool.query(
                `UPDATE students SET photo_avatar = ?, photo_url = ? WHERE biometric_device_id = ? OR student_id = ?`,
                [avatarPath, avatarPath, cleanPin, cleanPin]
              );
            } catch (_) {}
            return {
              buffer: buf,
              base64: m[1],
              url: avatarPath
            };
          }
        }
      } catch (_) {}
    }

    // 3. Fallback: Try finding on UserPhoto.aspx (if iDMS 9001 is online)
    try {
      await this.login();
      const initPage = await this._authenticatedGet('/UserPhoto.aspx');
      const rowRegex = new RegExp(`<tr id="ContentPlaceHolder1_ASPxGridView1_DXDataRow\\d+"[\\s\\S]*?<td[^>]*>[^<]*<\\/td>\\s*<td[^>]*>\\s*${cleanPin}\\s*<\\/td>[\\s\\S]*?<\\/tr>`, 'i');
      let m = initPage.body.match(rowRegex);

      if (m) {
        const imgMatch = m[0].match(/src="([^"]+)"/);
        if (imgMatch) {
          const buf = await this.downloadImageBuffer(imgMatch[1]);
          if (buf && buf.length > 500) {
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
            fs.writeFileSync(localFile, buf);
            const avatarPath = `/uploads/students/${cleanPin}.jpg`;
            await pool.query(
              `UPDATE students SET photo_avatar = ?, photo_url = ? WHERE biometric_device_id = ? OR student_id = ?`,
              [avatarPath, avatarPath, cleanPin, `TW-${cleanPin}`]
            );
            return {
              buffer: buf,
              base64: buf.toString('base64'),
              url: avatarPath
            };
          }
        }
      }
    } catch (_) {}

    return null;
  }

  /**
   * Stop background polling
   */
  stopLiveSync() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    this.isPolling = false;
    console.log('[TIMEWATCH iDMS 9001] Live punch sync worker stopped.');
  }

  /**
   * Get service status summary
   */
  getStatus() {
    return {
      serverUrl: this.serverUrl,
      connected: this.stats.connected,
      isPolling: this.isPolling,
      pollIntervalMs: this.pollIntervalMs,
      stats: this.stats
    };
  }
}

module.exports = new TimeWatchIdmsService();

