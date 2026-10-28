const { pool } = require('../config/database');

async function getAuditLogs(req, res, next) {
  try {
    const {
      actorRole,
      action,
      entityType,
      startDate,
      endDate,
      search,
      page = 1,
      limit = 25
    } = req.query;

    const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    const conditions = [];
    const params = [];

    if (actorRole) {
      conditions.push('actor_role = ?');
      params.push(actorRole);
    }

    if (action) {
      conditions.push('action = ?');
      params.push(action);
    }

    if (entityType) {
      conditions.push('entity_type = ?');
      params.push(entityType);
    }

    if (startDate) {
      conditions.push('created_at >= ?');
      params.push(`${startDate} 00:00:00`);
    }

    if (endDate) {
      conditions.push('created_at <= ?');
      params.push(`${endDate} 23:59:59`);
    }

    if (search && search.trim()) {
      conditions.push('(actor_name LIKE ? OR details LIKE ? OR entity_id LIKE ?)');
      const t = `%${search.trim()}%`;
      params.push(t, t, t);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM audit_logs ${whereClause}`,
      params
    );

    const [logs] = await pool.query(
      `SELECT * FROM audit_logs
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit, 10), offset]
    );

    return res.json({
      success: true,
      data: logs,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalPages: Math.ceil(total / parseInt(limit, 10))
      }
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAuditLogs
};
