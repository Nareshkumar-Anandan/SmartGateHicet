const { pool } = require('../config/database');

async function logAudit({ userId, actorName, actorRole, action, entityType, entityId, details, ipAddress }) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, actor_name, actor_role, action, entity_type, entity_id, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId || null,
        actorName || 'System',
        actorRole || 'SYSTEM',
        action,
        entityType,
        entityId ? String(entityId) : null,
        typeof details === 'object' ? JSON.stringify(details) : details,
        ipAddress || '127.0.0.1'
      ]
    );
  } catch (error) {
    console.error('Audit Log recording failed:', error.message);
  }
}

module.exports = {
  logAudit
};
