const { pool, withTransaction } = require('../config/database');
const { logAudit } = require('../middleware/auditLogger');

async function getOutings(req, res, next) {
  try {
    const {
      status,
      outingType,
      studentId,
      startDate,
      endDate,
      search,
      page = 1,
      limit = 20
    } = req.query;

    const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    const conditions = [];
    const params = [];

    if (status) {
      conditions.push('o.status = ?');
      params.push(status);
    }

    if (outingType) {
      conditions.push('o.outing_type = ?');
      params.push(outingType);
    }

    if (studentId) {
      conditions.push('o.student_id = ?');
      params.push(studentId);
    }

    if (startDate) {
      conditions.push('o.departure_date >= ?');
      params.push(startDate);
    }

    if (endDate) {
      conditions.push('o.departure_date <= ?');
      params.push(endDate);
    }

    if (search && search.trim()) {
      conditions.push('(s.student_id LIKE ? OR s.first_name LIKE ? OR s.last_name LIKE ? OR o.destination LIKE ?)');
      const t = `%${search.trim()}%`;
      params.push(t, t, t, t);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Total count
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total 
       FROM outings o 
       JOIN students s ON o.student_id = s.id 
       ${whereClause}`,
      params
    );

    // List query
    const [outings] = await pool.query(
      `SELECT 
        o.*,
        s.student_id as student_roll, s.first_name, s.last_name, s.department, s.phone as student_phone,
        s.parent_phone, s.current_location_status,
        h.name as hostel_name, r.room_number,
        u_appr.full_name as approved_by_name,
        u_manual.full_name as manual_return_by_name
       FROM outings o
       JOIN students s ON o.student_id = s.id
       LEFT JOIN hostels h ON s.hostel_id = h.id
       LEFT JOIN rooms r ON s.room_id = r.id
       LEFT JOIN users u_appr ON o.approved_by_user_id = u_appr.id
       LEFT JOIN users u_manual ON o.manual_return_confirmed_by = u_manual.id
       ${whereClause}
       ORDER BY o.departure_date DESC, o.departure_time DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit, 10), offset]
    );

    return res.json({
      success: true,
      data: outings,
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

async function createOuting(req, res, next) {
  try {
    const {
      student_id,
      outing_type = 'LOCAL_OUTING',
      departure_date,
      departure_time,
      expected_return_date,
      expected_return_time,
      destination,
      reason,
      auto_approve = false,
      approval_remarks
    } = req.body;

    if (!student_id || !departure_date || !departure_time || !expected_return_date || !expected_return_time || !destination || !reason) {
      return res.status(400).json({
        success: false,
        message: 'Required fields: student_id, departure_date, departure_time, expected_return_date, expected_return_time, destination, reason.'
      });
    }

    // Resolve student
    const [students] = await pool.query(
      'SELECT id, student_id, first_name, last_name, is_active FROM students WHERE id = ? OR student_id = ?',
      [student_id, student_id]
    );

    if (students.length === 0) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    const student = students[0];
    if (!student.is_active) {
      return res.status(400).json({ success: false, message: 'Cannot create outing for an inactive student.' });
    }

    // Check if student already has a pending or active approved outing
    const [activeOutings] = await pool.query(
      `SELECT id, status FROM outings 
       WHERE student_id = ? AND status IN ('PENDING', 'APPROVED')`,
      [student.id]
    );

    if (activeOutings.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Student already has an active outing (#${activeOutings[0].id}) in status '${activeOutings[0].status}'. Resolve it first.`
      });
    }

    const initialStatus = auto_approve ? 'APPROVED' : 'PENDING';
    const approvedBy = auto_approve ? req.user.id : null;
    const decisionAt = auto_approve ? new Date() : null;

    const [result] = await pool.query(
      `INSERT INTO outings 
       (student_id, outing_type, departure_date, departure_time, expected_return_date, expected_return_time, destination, reason, status, approved_by_user_id, approval_remarks, decision_at, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        student.id,
        outing_type,
        departure_date,
        departure_time,
        expected_return_date,
        expected_return_time,
        destination.trim(),
        reason.trim(),
        initialStatus,
        approvedBy,
        approval_remarks || null,
        decisionAt,
        req.user.id
      ]
    );

    await logAudit({
      userId: req.user.id,
      actorName: req.user.full_name,
      actorRole: req.user.role,
      action: 'OUTING_CREATED',
      entityType: 'OUTING',
      entityId: result.insertId,
      details: `Created ${outing_type} pass for ${student.first_name} ${student.last_name} (${student.student_id}) to ${destination} [Status: ${initialStatus}]`,
      ipAddress: req.ip
    });

    return res.status(201).json({
      success: true,
      message: `Outing request created successfully with status '${initialStatus}'.`,
      outingId: result.insertId
    });
  } catch (error) {
    next(error);
  }
}

async function approveOuting(req, res, next) {
  try {
    const { id } = req.params;
    const { remarks } = req.body;

    const [outings] = await pool.query(
      `SELECT o.*, s.student_id as student_roll, s.first_name, s.last_name 
       FROM outings o 
       JOIN students s ON o.student_id = s.id 
       WHERE o.id = ?`,
      [id]
    );

    if (outings.length === 0) {
      return res.status(404).json({ success: false, message: 'Outing request not found.' });
    }

    const outing = outings[0];
    if (outing.status !== 'PENDING') {
      return res.status(400).json({
        success: false,
        message: `Cannot approve outing: Current status is '${outing.status}', expected 'PENDING'.`
      });
    }

    await pool.query(
      `UPDATE outings 
       SET status = 'APPROVED', 
           approved_by_user_id = ?, 
           approval_remarks = ?, 
           decision_at = NOW(), 
           updated_at = NOW() 
       WHERE id = ?`,
      [req.user.id, remarks || 'Sanctioned by Hostel Warden.', id]
    );

    await logAudit({
      userId: req.user.id,
      actorName: req.user.full_name,
      actorRole: req.user.role,
      action: 'OUTING_APPROVED',
      entityType: 'OUTING',
      entityId: id,
      details: `Approved outing for ${outing.first_name} ${outing.last_name} (${outing.student_roll}). Remarks: ${remarks || 'None'}`,
      ipAddress: req.ip
    });

    return res.json({
      success: true,
      message: 'Outing request approved successfully. Gate barrier will allow exit during the departure window.'
    });
  } catch (error) {
    next(error);
  }
}

async function rejectOuting(req, res, next) {
  try {
    const { id } = req.params;
    const { remarks } = req.body;

    if (!remarks || !remarks.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Rejection remarks are required to explain the reason.'
      });
    }

    const [outings] = await pool.query(
      `SELECT o.*, s.student_id as student_roll, s.first_name, s.last_name 
       FROM outings o 
       JOIN students s ON o.student_id = s.id 
       WHERE o.id = ?`,
      [id]
    );

    if (outings.length === 0) {
      return res.status(404).json({ success: false, message: 'Outing request not found.' });
    }

    await pool.query(
      `UPDATE outings 
       SET status = 'REJECTED', 
           approved_by_user_id = ?, 
           approval_remarks = ?, 
           decision_at = NOW(), 
           updated_at = NOW() 
       WHERE id = ?`,
      [req.user.id, remarks.trim(), id]
    );

    await logAudit({
      userId: req.user.id,
      actorName: req.user.full_name,
      actorRole: req.user.role,
      action: 'OUTING_REJECTED',
      entityType: 'OUTING',
      entityId: id,
      details: `Rejected outing for ${outings[0].first_name} ${outings[0].last_name}. Reason: ${remarks}`,
      ipAddress: req.ip
    });

    return res.json({
      success: true,
      message: 'Outing request rejected.'
    });
  } catch (error) {
    next(error);
  }
}

async function confirmManualReturn(req, res, next) {
  try {
    const { id } = req.params;
    const { remarks } = req.body;

    const [outings] = await pool.query(
      `SELECT o.*, s.id as st_id, s.first_name, s.last_name, s.student_id as roll
       FROM outings o
       JOIN students s ON o.student_id = s.id
       WHERE o.id = ?`,
      [id]
    );

    if (outings.length === 0) {
      return res.status(404).json({ success: false, message: 'Outing not found.' });
    }

    const outing = outings[0];

    await withTransaction(async (conn) => {
      await conn.query(
        `UPDATE outings 
         SET status = 'COMPLETED',
             actual_return_time = NOW(),
             manual_return_confirmed_by = ?,
             manual_return_remarks = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [req.user.id, remarks || 'Manual verification by Warden', id]
      );

      // Set student location to INSIDE
      await conn.query(
        'UPDATE students SET current_location_status = "INSIDE", updated_at = NOW() WHERE id = ?',
        [outing.st_id]
      );
    });

    await logAudit({
      userId: req.user.id,
      actorName: req.user.full_name,
      actorRole: req.user.role,
      action: 'MANUAL_RETURN_CONFIRMED',
      entityType: 'OUTING',
      entityId: id,
      details: `Manual return confirmed for ${outing.first_name} ${outing.last_name} (${outing.roll}). Remarks: ${remarks || 'None'}`,
      ipAddress: req.ip
    });

    return res.json({
      success: true,
      message: 'Manual return recorded. Student status updated to INSIDE.'
    });
  } catch (error) {
    next(error);
  }
}

async function getOverdueOutings(req, res, next) {
  try {
    const [overdue] = await pool.query(`
      SELECT 
        o.id, o.outing_type, o.departure_date, o.departure_time, o.expected_return_date, o.expected_return_time,
        o.actual_departure_time, o.destination, o.reason, o.status,
        s.id as student_id, s.student_id as student_roll, s.first_name, s.last_name, s.department,
        s.phone as student_phone, s.parent_phone, s.current_location_status,
        h.name as hostel_name, r.room_number,
        TIMESTAMPDIFF(MINUTE, CONCAT(o.expected_return_date, ' ', o.expected_return_time), NOW()) as minutes_overdue
      FROM outings o
      JOIN students s ON o.student_id = s.id
      LEFT JOIN hostels h ON s.hostel_id = h.id
      LEFT JOIN rooms r ON s.room_id = r.id
      WHERE (o.status = 'OVERDUE')
         OR (o.status = 'APPROVED' AND CONCAT(o.expected_return_date, ' ', o.expected_return_time) < NOW() AND s.current_location_status = 'OUTSIDE')
      ORDER BY minutes_overdue DESC
    `);

    return res.json({ success: true, count: overdue.length, data: overdue });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getOutings,
  createOuting,
  approveOuting,
  rejectOuting,
  confirmManualReturn,
  getOverdueOutings
};
