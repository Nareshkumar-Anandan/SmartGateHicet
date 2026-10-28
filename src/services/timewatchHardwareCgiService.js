const http = require('http');
const crypto = require('crypto');

/**
 * Service for direct HTTP Digest CGI communication with Dahua / TimeWatch TrueFace terminals.
 * Terminals operate an embedded web service on port 80.
 * Supported hardware actions:
 * - openDoor: Triggers the physical dry contact relay for turnstile barrier release (3s pulse).
 * - getDoorStatus: Queries current door/relay state.
 */
class TimewatchHardwareCgiService {
  constructor() {
    this.defaultUser = process.env.TIMEWATCH_DEVICE_USER || 'admin';
    this.defaultPassword = process.env.TIMEWATCH_DEVICE_PASSWORD || 'tipl9910';
    this.defaultPort = parseInt(process.env.TIMEWATCH_DEVICE_HTTP_PORT || '80', 10);
  }

  md5(str) {
    return crypto.createHash('md5').update(str).digest('hex');
  }

  parseDigestHeader(header) {
    const params = {};
    const regex = /(\w+)="?([^",]+)"?/g;
    let match;
    while ((match = regex.exec(header)) !== null) {
      params[match[1]] = match[2];
    }
    return params;
  }

  buildDigestAuth(username, password, method, uri, authHeader) {
    const p = this.parseDigestHeader(authHeader);
    const realm = p.realm || '';
    const nonce = p.nonce || '';
    const qop = p.qop || '';
    const cnonce = crypto.randomBytes(8).toString('hex');
    const nc = '00000001';

    const ha1 = this.md5(`${username}:${realm}:${password}`);
    const ha2 = this.md5(`${method}:${uri}`);
    let response;
    if (qop && qop.includes('auth')) {
      response = this.md5(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`);
    } else {
      response = this.md5(`${ha1}:${nonce}:${ha2}`);
    }

    let auth = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}", algorithm=MD5`;
    if (p.opaque) auth += `, opaque="${p.opaque}"`;
    if (qop && qop.includes('auth')) auth += `, qop=auth, nc=${nc}, cnonce="${cnonce}"`;
    return auth;
  }

  /**
   * Executes an authenticated CGI request against a terminal IP.
   */
  async requestCgi(ip, uri, options = {}) {
    const port = options.port || this.defaultPort;
    const username = options.username || this.defaultUser;
    const password = options.password || this.defaultPassword;
    const timeout = options.timeout || 3000;

    // Step 1: Initial challenge request
    const authHeader = await new Promise((resolve) => {
      const req = http.get({ hostname: ip, port, path: uri, timeout }, (res) => {
        resolve(res.headers['www-authenticate'] || null);
      });
      req.on('error', (err) => {
        console.error(`[CGI CHALLENGE ERROR] ${ip}:${port}${uri} -> ${err.message}`);
        resolve(null);
      });
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
    });

    if (!authHeader) {
      throw new Error(`Failed to obtain Digest authentication challenge from terminal at ${ip}:${port}`);
    }

    // Step 2: Digest authenticated request
    const authVal = this.buildDigestAuth(username, password, 'GET', uri, authHeader);
    return new Promise((resolve, reject) => {
      const req = http.get(
        {
          hostname: ip,
          port,
          path: uri,
          headers: { Authorization: authVal },
          timeout
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode,
              body: data.trim()
            });
          });
        }
      );

      req.on('error', (err) => {
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Timeout waiting for CGI response from ${ip}:${port}`));
      });
    });
  }

  /**
   * Triggers physical barrier release by energizing the terminal relay.
   * Direct Dahua CGI endpoint: /cgi-bin/accessControl.cgi?action=openDoor&channel=1
   * @param {string} ip Terminal IP address
   * @param {number} channel Door channel (default 1)
   */
  async openBarrier(ip, channel = 1) {
    const uri = `/cgi-bin/accessControl.cgi?action=openDoor&channel=${channel}`;
    try {
      const res = await this.requestCgi(ip, uri);
      if (res.statusCode === 200 && res.body.includes('OK')) {
        console.log(`[HARDWARE BARRIER UNLOCK] Successfully triggered physical turnstile relay on ${ip} (Channel ${channel})`);
        return {
          success: true,
          statusCode: res.statusCode,
          message: `Turnstile barrier unlocked on ${ip}`,
          rawResponse: res.body
        };
      } else {
        console.warn(`[HARDWARE BARRIER UNLOCK] Terminal ${ip} responded with status ${res.statusCode}: ${res.body}`);
        return {
          success: false,
          statusCode: res.statusCode,
          message: `Turnstile terminal ${ip} rejected openDoor command: ${res.body}`,
          rawResponse: res.body
        };
      }
    } catch (err) {
      console.error(`[HARDWARE BARRIER UNLOCK ERROR] Could not open barrier on ${ip}: ${err.message}`);
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Query the current door/barrier status from the terminal.
   */
  async getDoorStatus(ip, channel = 1) {
    const uri = `/cgi-bin/accessControl.cgi?action=getDoorStatus&channel=${channel}`;
    try {
      const res = await this.requestCgi(ip, uri);
      return {
        success: res.statusCode === 200,
        status: res.body
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }
}

module.exports = new TimewatchHardwareCgiService();
