const { pool } = require('../config/database');
const { logAudit } = require('../middleware/auditLogger');

async function getIncidents(req, res, next) {
  try {
    const { status, severity, incidentType, search, page = 1, limit = 20 } = req.query;
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    const conditions = [];
    const params = [];

    if (status) {
      conditions.push('i.status = ?');
      params.push(status);
    }
    if (severity) {
      conditions.push('i.severity = ?');
      params.push(severity);
    }
    if (incidentType) {
      conditions.push('i.incident_type = ?');
      params.push(incidentType);
    }
    if (search && search.trim()) {
      conditions.push('(i.title LIKE ? OR i.description LIKE ? OR s.first_name LIKE ? OR s.student_id LIKE ?)');
      const t = `%${search.trim()}%`;
      params.push(t, t, t, t);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total 
       FROM incidents i 
       LEFT JOIN students s ON i.student_id = s.id 
       ${where}`,
      params
    );

    const [incidents] = await pool.query(
      `SELECT 
        i.*,
        s.student_id as student_roll, s.first_name as student_first_name, s.last_name as student_last_name,
        d.device_name, d.device_code,
        u_rep.full_name as reported_by_name,
        u_ass.full_name as assigned_to_name
       FROM incidents i
       LEFT JOIN students s ON i.student_id = s.id
       LEFT JOIN gate_devices d ON i.gate_device_id = d.id
       LEFT JOIN users u_rep ON i.reported_by_user_id = u_rep.id
       LEFT JOIN users u_ass ON i.assigned_to_user_id = u_ass.id
       ${where}
       ORDER BY i.reported_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit, 10), offset]
    );

    return res.json({
      success: true,
      data: incidents,
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

async function createIncident(req, res, next) {
  try {
    const {
      incident_type,
      title,
      description,
      student_id,
      gate_device_id,
      assigned_to_user_id,
      severity = 'MEDIUM'
    } = req.body;

    if (!incident_type || !title || !description) {
      return res.status(400).json({
        success: false,
        message: 'Required fields: incident_type, title, description.'
      });
    }

    let stId = student_id || null;
    if (stId) {
      const [stRows] = await pool.query('SELECT id FROM students WHERE id = ? OR student_id = ?', [stId, stId]);
      stId = stRows.length > 0 ? stRows[0].id : null;
    }

    const [result] = await pool.query(
      `INSERT INTO incidents 
       (incident_type, title, description, student_id, gate_device_id, reported_by_user_id, assigned_to_user_id, severity, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')`,
      [
        incident_type,
        title.trim(),
        description.trim(),
        stId,
        gate_device_id || null,
        req.user.id,
        assigned_to_user_id || req.user.id,
        severity
      ]
    );

    await logAudit({
      userId: req.user.id,
      actorName: req.user.full_name,
      actorRole: req.user.role,
      action: 'INCIDENT_RECORDED',
      entityType: 'INCIDENT',
      entityId: result.insertId,
      details: `Recorded incident: ${title} [${severity}]`,
      ipAddress: req.ip
    });

    return res.status(201).json({
      success: true,
      message: 'Incident registered successfully.',
      incidentId: result.insertId
    });
  } catch (error) {
    next(error);
  }
}

async function updateIncident(req, res, next) {
  try {
    const { id } = req.params;
    const { status, resolution_notes, assigned_to_user_id, severity } = req.body;

    const [existing] = await pool.query('SELECT * FROM incidents WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Incident record not found.' });
    }

    const resolvedAt = status === 'RESOLVED' ? new Date() : existing[0].resolved_at;

    await pool.query(
      `UPDATE incidents 
       SET status = ?, resolution_notes = ?, assigned_to_user_id = ?, severity = ?, resolved_at = ?
       WHERE id = ?`,
      [
        status || existing[0].status,
        resolution_notes !== undefined ? resolution_notes : existing[0].resolution_notes,
        assigned_to_user_id || existing[0].assigned_to_user_id,
        severity || existing[0].severity,
        resolvedAt,
        id
      ]
    );

    await logAudit({
      userId: req.user.id,
      actorName: req.user.full_name,
      actorRole: req.user.role,
      action: 'INCIDENT_UPDATED',
      entityType: 'INCIDENT',
      entityId: id,
      details: `Updated incident #${id} to status ${status}. Resolution: ${resolution_notes || 'N/A'}`,
      ipAddress: req.ip
    });

    return res.json({ success: true, message: 'Incident updated successfully.' });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getIncidents,
  createIncident,
  updateIncident
};
