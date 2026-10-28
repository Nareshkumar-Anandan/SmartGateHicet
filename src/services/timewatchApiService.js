/**
 * TimeWatch Web API (TWAPI) Client
 * Integration service for TimeWatch TrueFace series facial terminals and management server.
 * Reference: TWAPI_Document & Postman Collection https://documenter.getpostman.com/view/47085392/2sB34oDd9q
 * Default Base URL: http://192.168.1.66:8001/TimeWatchAPI
 * Header: X-Api-Key: T!meW@tch#123@
 */

const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

class TimeWatchApiService {
  constructor() {
    this.apiUrl = (process.env.TIMEWATCH_API_URL || 'http://127.0.0.1:8001/TimeWatchAPI').replace(/\/+$/, '');
    this.apiKey = process.env.TIMEWATCH_API_KEY || 'T!meW@tch#123@';
    this.timeoutMs = parseInt(process.env.TIMEWATCH_API_TIMEOUT_MS, 10) || 8000;
  }

  /**
   * Get current configuration (masks secret key for safe display)
   */
  getConfig() {
    return {
      apiUrl: this.apiUrl,
      apiKeyMasked: this.apiKey ? `${this.apiKey.slice(0, 3)}••••••••${this.apiKey.slice(-2)}` : '',
      timeoutMs: this.timeoutMs
    };
  }

  /**
   * Update API configuration at runtime
   */
  updateConfig({ apiUrl, apiKey, timeoutMs }) {
    if (apiUrl) this.apiUrl = apiUrl.replace(/\/+$/, '');
    if (apiKey) this.apiKey = apiKey;
    if (timeoutMs) this.timeoutMs = parseInt(timeoutMs, 10);
    return this.getConfig();
  }

  /**
   * Generic request wrapper with X-Api-Key authorization and abort timeout
   */
  async _request(endpoint, options = {}) {
    const url = `${this.apiUrl}/${endpoint.replace(/^\/+/, '')}`;
    const method = options.method || 'POST';

    const headers = {
      'Content-Type': 'application/json',
      'X-Api-Key': this.apiKey,
      ...(options.headers || {})
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || this.timeoutMs);

    const fetchOptions = {
      method,
      headers,
      signal: controller.signal
    };

    if (options.body && method !== 'GET' && method !== 'HEAD') {
      fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }

    const startTime = Date.now();
    try {
      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;

      const contentType = response.headers.get('content-type') || '';
      let data = null;
      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const text = await response.text();
        try {
          data = JSON.parse(text);
        } catch {
          data = { text };
        }
      }

      if (!response.ok) {
        return {
          success: false,
          status: response.status,
          statusText: response.statusText,
          message: data?.message || data?.Msg || `TimeWatch API responded with HTTP ${response.status}`,
          data,
          latencyMs
        };
      }

      return {
        success: true,
        status: response.status,
        data,
        latencyMs
      };
    } catch (err) {
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;
      const isTimeout = err.name === 'AbortError';

      return {
        success: false,
        error: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
        message: isTimeout
          ? `TimeWatch API request to ${endpoint} timed out after ${this.timeoutMs}ms`
          : `Failed to connect to TimeWatch API (${this.apiUrl}): ${err.message}`,
        latencyMs
      };
    }
  }

  /**
   * 0. Test Connection to TimeWatch Server
   */
  async testConnection() {
    // Attempt GetDeviceList with empty body to verify API Key & connectivity
    const res = await this._request('/GetDeviceList', {
      method: 'POST',
      body: {},
      timeoutMs: 4000
    });

    return {
      connected: res.success,
      apiUrl: this.apiUrl,
      latencyMs: res.latencyMs,
      details: res
    };
  }

  /**
   * 1. GetUserDetails / GetUserDetail
   * Retrieves user details based on UserID and/or DeviceID.
   * At least one parameter is required.
   */
  async getUserDetails({ UserID = '', DeviceID = '' } = {}) {
    if (!UserID && !DeviceID) {
      throw new Error('At least one parameter — UserID or DeviceID — must be provided.');
    }
    const body = {};
    if (UserID) body.UserID = String(UserID);
    if (DeviceID) body.DeviceID = String(DeviceID);

    // Primary endpoint: /GetUserDetails; fallback endpoint: /GetUserDetail
    let res = await this._request('/GetUserDetails', {
      method: 'POST',
      body
    });

    if (!res.success && (res.status === 404 || res.status === 405)) {
      res = await this._request('/GetUserDetail', {
        method: 'POST',
        body
      });
    }

    return res;
  }

  async getUserDetail(params) {
    return this.getUserDetails(params);
  }

  /**
   * 2. AddUser
   * Adds a new user to a specified device with optional card and base64 face template.
   */
  async addUser({
    UserID,
    Name,
    DeviceID,
    AccesstimeFrom = '',
    AccesstimeTo = '',
    Card = '',
    FaceTemplate = ''
  }) {
    if (!UserID || !Name || !DeviceID) {
      throw new Error('UserID, Name, and DeviceID are mandatory.');
    }

    const body = {
      UserID: String(UserID),
      Name: String(Name),
      DeviceID: String(DeviceID)
    };

    if (AccesstimeFrom) body.AccesstimeFrom = AccesstimeFrom;
    if (AccesstimeTo) body.AccesstimeTo = AccesstimeTo;
    if (Card) body.Card = String(Card);
    if (FaceTemplate) body.FaceTemplate = FaceTemplate;

    return await this._request('/AddUser', {
      method: 'POST',
      body
    });
  }

  /**
   * 3. DeleteUser
   * Deletes a user from a specific device.
   */
  async deleteUser({ UserID, DeviceID }) {
    if (!UserID || !DeviceID) {
      throw new Error('Both UserID and DeviceID are mandatory.');
    }

    return await this._request('/DeleteUser', {
      method: 'POST',
      body: {
        UserID: String(UserID),
        DeviceID: String(DeviceID)
      }
    });
  }

  /**
   * 4. GetPunchData
   * Retrieves attendance punch data within a given date range.
   * FromDate and ToDate format: YYYY-MM-DD
   */
  async getPunchData({ FromDate, ToDate, DeviceID = '', UserID = '' }) {
    if (!FromDate || !ToDate) {
      throw new Error('FromDate and ToDate are required (format: YYYY-MM-DD).');
    }

    const body = {
      FromDate: String(FromDate).trim(),
      ToDate: String(ToDate).trim()
    };
    if (DeviceID) body.DeviceID = String(DeviceID).trim();
    if (UserID) body.UserID = String(UserID).trim();

    return await this._request('/GetPunchData', {
      method: 'POST',
      body
    });
  }

  /**
   * 5. GetUserImage
   * Retrieves face image of a specific user from a specified device.
   */
  async getUserImage({ DeviceID, UserID }) {
    if (!DeviceID || !UserID) {
      throw new Error('Both DeviceID and UserID are mandatory.');
    }

    // Try GET with query parameters first, then fall back to POST with body
    const query = new URLSearchParams({ DeviceID, UserID }).toString();
    let res = await this._request(`/GetUserImage?${query}`, { method: 'GET' });

    if (!res.success && (res.status === 404 || res.status === 405)) {
      res = await this._request('/GetUserImage', {
        method: 'POST',
        body: { DeviceID: String(DeviceID), UserID: String(UserID) }
      });
    }

    return res;
  }

  /**
   * 6. GetDeviceList
   * Retrieves details of a specific device or all devices.
   */
  async getDeviceList(SerialNumber = '') {
    const body = {};
    if (SerialNumber) body.SerialNumber = String(SerialNumber).trim();

    return await this._request('/GetDeviceList', {
      method: 'POST',
      body
    });
  }

  /**
   * 7. SyncTime
   * Syncs the current server time to specified device(s).
   */
  async syncTime(DeviceList) {
    const list = Array.isArray(DeviceList) ? DeviceList : [DeviceList];
    const cleaned = list.map(d => String(d).trim()).filter(Boolean);

    if (cleaned.length === 0) {
      throw new Error('DeviceList array must contain at least one valid serial number.');
    }

    return await this._request('/SyncTime', {
      method: 'POST',
      body: { DeviceList: cleaned }
    });
  }

  /**
   * 8. PullLogs
   * Commands retrieval of log data from device(s) within a given date-time range.
   */
  async pullLogs({ DeviceList, FromDate, ToDate }) {
    const list = Array.isArray(DeviceList) ? DeviceList : [DeviceList];
    const cleaned = list.map(d => String(d).trim()).filter(Boolean);

    if (cleaned.length === 0) {
      throw new Error('DeviceList array must contain at least one valid serial number.');
    }

    const body = {
      DeviceList: cleaned
    };
    if (FromDate) body.FromDate = String(FromDate);
    if (ToDate) body.ToDate = String(ToDate);

    return await this._request('/PullLogs', {
      method: 'POST',
      body
    });
  }

  /**
   * 9. GetCommands
   * Retrieves command entries (such as uploads or instructions) based on execution status.
   * Executed: "true" | "false"
   */
  async getCommands({ Executed = 'false', TransferToDevice = '' } = {}) {
    const execStr = String(Executed).toLowerCase() === 'true' ? 'true' : 'false';
    const body = { Executed: execStr };
    if (TransferToDevice) body.TransferToDevice = String(TransferToDevice).trim();

    return await this._request('/GetCommands', {
      method: 'POST',
      body
    });
  }

  /**
   * 10. RemoteEnrollment
   * Enrolls user remotely on TrueFace series terminals.
   * Type: 'FACE' | 'CARD' | 'FP'
   */
  async remoteEnrollment({ DeviceID, UserID, Type = 'FACE' }) {
    if (!DeviceID || !UserID) {
      throw new Error('DeviceID and UserID are mandatory.');
    }

    const validTypes = ['FACE', 'CARD', 'FP'];
    const enrollType = String(Type).toUpperCase().trim();
    if (!validTypes.includes(enrollType)) {
      throw new Error(`Invalid Type '${Type}'. Must be one of: CARD, FACE, FP`);
    }

    return await this._request('/RemoteEnrollment', {
      method: 'POST',
      body: {
        DeviceID: String(DeviceID).trim(),
        UserID: String(UserID).trim(),
        Type: enrollType
      }
    });
  }
}

module.exports = new TimeWatchApiService();
