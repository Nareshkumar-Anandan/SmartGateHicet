const { pool } = require('../config/database');
const { logAudit } = require('../middleware/auditLogger');
const deviceManager = require('../services/deviceManager');

async function getSettings(req, res, next) {
  try {
    const [rows] = await pool.query('SELECT setting_key, setting_value, description, updated_at FROM system_settings');
    const settings = {};
    rows.forEach(r => {
      settings[r.setting_key] = { value: r.setting_value, description: r.description, updatedAt: r.updated_at };
    });

    return res.json({ success: true, settings });
  } catch (error) {
    next(error);
  }
}

async function updateSettings(req, res, next) {
  try {
    const { settings } = req.body; // Key-value map

    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ success: false, message: 'Settings payload must be an object of key-value pairs.' });
    }

    for (const [key, value] of Object.entries(settings)) {
      await pool.query(
        `UPDATE system_settings 
         SET setting_value = ?, updated_by = ?, updated_at = NOW() 
         WHERE setting_key = ?`,
        [String(value), req.user.id, key]
      );
    }

    await logAudit({
      userId: req.user.id,
      actorName: req.user.full_name,
      actorRole: req.user.role,
      action: 'SYSTEM_SETTINGS_UPDATED',
      entityType: 'SETTINGS',
      entityId: 'SYSTEM',
      details: `Updated system settings: ${Object.keys(settings).join(', ')}`,
      ipAddress: req.ip
    });

    return res.json({ success: true, message: 'System settings updated successfully.' });
  } catch (error) {
    next(error);
  }
}

/**
 * Emergency Gate Release Protocol
 * Controls barrier override states: NORMAL, OPEN_ALL (Free egress drop-arm), LOCKDOWN
 */
async function triggerEmergencyOverride(req, res, next) {
  try {
    const { mode } = req.body; // 'NORMAL', 'OPEN_ALL', 'LOCKDOWN'

    if (!['NORMAL', 'OPEN_ALL', 'LOCKDOWN'].includes(mode)) {
      return res.status(400).json({ success: false, message: 'Invalid emergency mode. Valid: NORMAL, OPEN_ALL, LOCKDOWN' });
    }

    await pool.query(
      `UPDATE system_settings 
       SET setting_value = ?, updated_by = ?, updated_at = NOW() 
       WHERE setting_key = 'emergency_lockdown'`,
      [mode, req.user.id]
    );

    // If OPEN_ALL, pulse all turnstile drop-arms / relays
    if (mode === 'OPEN_ALL') {
      const [devices] = await pool.query('SELECT id, device_code FROM gate_devices');
      for (const d of devices) {
        try {
          await deviceManager.triggerRelay(d.id, 60000); // 60s hold or solenoid drop
        } catch (e) {
          console.error(`Failed to trigger emergency release on device ${d.device_code}:`, e.message);
        }
      }
    }

    await logAudit({
      userId: req.user.id,
      actorName: req.user.full_name,
      actorRole: req.user.role,
      action: 'EMERGENCY_OVERRIDE_CHANGED',
      entityType: 'GATE_CONTROL',
      entityId: 'ALL_GATES',
      details: `Emergency gate mode changed to ${mode} by ${req.user.full_name}`,
      ipAddress: req.ip
    });

    return res.json({
      success: true,
      mode,
      message: mode === 'OPEN_ALL'
        ? 'EMERGENCY EGRESS ACTIVATED: All turnstile barrier gates commanded to open for free pedestrian evacuation.'
        : `Emergency mode updated to ${mode}.`
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getSettings,
  updateSettings,
  triggerEmergencyOverride
};
