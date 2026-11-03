const { pool } = require('../config/database');
const deviceManager = require('../services/deviceManager');
const { logAudit } = require('../middleware/auditLogger');

let lastDeviceStatusSync = 0;

async function getDevices(req, res, next) {
  try {
    // 1. Mark stale devices OFFLINE in the database (older than 300s or NULL last_heartbeat)
    await pool.query(`
      UPDATE gate_devices 
      SET status = 'OFFLINE', updated_at = NOW() 
      WHERE (last_heartbeat IS NULL OR last_heartbeat < NOW() - INTERVAL 300 SECOND) 
        AND status = 'ONLINE'
    `);

    // 2. Periodically trigger TimeWatch iDMS device status check (debounced to every 15s)
    const now = Date.now();
    if (now - lastDeviceStatusSync > 15000) {
      lastDeviceStatusSync = now;
      const timewatchIdmsService = require('../services/timewatchIdmsService');
      timewatchIdmsService.syncDeviceStatuses().catch(() => {});
    }

    const [devices] = await pool.query(`
      SELECT 
        d.*,
        CASE 
          WHEN d.last_heartbeat >= NOW() - INTERVAL 300 SECOND AND d.status = 'ONLINE' THEN 'ONLINE'
          ELSE 'OFFLINE'
        END as status,
        (SELECT COUNT(*) FROM gate_events e WHERE e.device_id = d.id AND e.event_timestamp >= NOW() - INTERVAL 24 HOUR) as events_today,
        (SELECT COUNT(*) FROM gate_events e WHERE e.device_id = d.id AND e.access_result = 'DENIED' AND e.event_timestamp >= NOW() - INTERVAL 24 HOUR) as denied_today
      FROM gate_devices d
      ORDER BY d.id ASC
    `);

    return res.json({ success: true, data: devices });
  } catch (error) {
    next(error);
  }
}

async function getDeviceById(req, res, next) {
  try {
    const { id } = req.params;
    const [devices] = await pool.query('SELECT * FROM gate_devices WHERE id = ?', [id]);
    if (devices.length === 0) {
      return res.status(404).json({ success: false, message: 'Device not found.' });
    }

    const adapter = await deviceManager.getAdapter(id);
    const liveStatus = await adapter.getStatus();

    return res.json({
      success: true,
      device: devices[0],
      liveStatus
    });
  } catch (error) {
    next(error);
  }
}

async function updateDevice(req, res, next) {
  try {
    const { id } = req.params;
    const {
      device_name,
      ip_address,
      port,
      location_description,
      lane_direction,
      turnstile_relay_pin,
      turnstile_unlock_duration_ms,
      status,
      integration_mode
    } = req.body;

    const [existing] = await pool.query('SELECT * FROM gate_devices WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Device not found.' });
    }

    await pool.query(
      `UPDATE gate_devices 
       SET device_name = ?, ip_address = ?, port = ?, location_description = ?,
           lane_direction = ?, turnstile_relay_pin = ?, turnstile_unlock_duration_ms = ?,
           status = ?, integration_mode = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        device_name || existing[0].device_name,
        ip_address || existing[0].ip_address,
        port || existing[0].port,
        location_description || existing[0].location_description,
        lane_direction || existing[0].lane_direction,
        turnstile_relay_pin || existing[0].turnstile_relay_pin,
        turnstile_unlock_duration_ms || existing[0].turnstile_unlock_duration_ms,
        status || existing[0].status,
        integration_mode || existing[0].integration_mode,
        id
      ]
    );

    await logAudit({
      userId: req.user.id,
      actorName: req.user.full_name,
      actorRole: req.user.role,
      action: 'DEVICE_CONFIG_UPDATED',
      entityType: 'DEVICE',
      entityId: id,
      details: `Updated configuration for device ${existing[0].device_code}`,
      ipAddress: req.ip
    });

    return res.json({ success: true, message: 'Device configuration saved.' });
  } catch (error) {
    next(error);
  }
}

async function testRelayPulse(req, res, next) {
  try {
    const { id } = req.params;

    const [devices] = await pool.query('SELECT * FROM gate_devices WHERE id = ?', [id]);
    if (devices.length === 0) {
      return res.status(404).json({ success: false, message: 'Device not found.' });
    }

    const device = devices[0];
    const { durationMs = device.turnstile_unlock_duration_ms || 10000 } = req.body;
    const result = await deviceManager.triggerRelay(device.id, durationMs);

    // Record an official gate access GRANTED event for this manual barrier release
    const crypto = require('crypto');
    const eventUuid = crypto.randomUUID();
    const direction = (device.lane_direction === 'EXIT') ? 'EXIT' : 'ENTRY';
    const dedupHash = crypto.createHash('sha256').update(`MANUAL_OVERRIDE:${device.id}:${Date.now()}`).digest('hex');

    const [eventInsert] = await pool.query(
      `INSERT INTO gate_events 
       (event_uuid, device_id, student_id, event_timestamp, direction, verification_type, access_result, denial_reason, related_outing_id, raw_payload, event_source, deduplication_hash, processed_status)
       VALUES (?, ?, NULL, NOW(), ?, 'FACE', 'GRANTED', NULL, NULL, ?, 'MANUAL', ?, 'PROCESSED')`,
      [
        eventUuid,
        device.id,
        direction,
        JSON.stringify({
          action: 'MANUAL_RELAY_RELEASE',
          actor: req.user?.full_name || 'System Administrator',
          durationMs,
          message: 'Turnstile barrier released manually (Access GRANTED)'
        }),
        dedupHash
      ]
    );

    await logAudit({
      userId: req.user?.id || 1,
      actorName: req.user?.full_name || 'System Super Administrator',
      actorRole: req.user?.role || 'SUPER_ADMIN',
      action: 'MANUAL_RELAY_TEST',
      entityType: 'DEVICE',
      entityId: id,
      details: `Triggered manual turnstile barrier release on ${device.device_code} (${durationMs}ms) - Access GRANTED`,
      ipAddress: req.ip
    });

    return res.json({
      success: true,
      access_result: 'GRANTED',
      message: `Turnstile relay pulse sent successfully (${durationMs}ms). Barrier solenoid commanded to unlock (Access GRANTED).`,
      eventId: eventInsert.insertId,
      result
    });
  } catch (error) {
    next(error);
  }
}

async function pingDevice(req, res, next) {
  try {
    const { id } = req.params;
    const [devices] = await pool.query('SELECT * FROM gate_devices WHERE id = ?', [id]);
    if (devices.length === 0) {
      return res.status(404).json({ success: false, message: 'Device not found.' });
    }

    const adapter = await deviceManager.getAdapter(id);
    const status = await adapter.getStatus();

    // Update database status and heartbeat
    if (status.online) {
      await pool.query('UPDATE gate_devices SET last_heartbeat = NOW(), status = "ONLINE", updated_at = NOW() WHERE id = ?', [id]);
    } else {
      await pool.query('UPDATE gate_devices SET status = "OFFLINE", updated_at = NOW() WHERE id = ?', [id]);
    }

    return res.json({
      success: true,
      device: devices[0].device_code,
      status
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getDevices,
  getDeviceById,
  updateDevice,
  testRelayPulse,
  pingDevice
};
