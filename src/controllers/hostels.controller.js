const { pool, withTransaction } = require('../config/database');
const { logAudit } = require('../middleware/auditLogger');

async function getHostels(req, res, next) {
  try {
    const [hostels] = await pool.query(`
      SELECT 
        h.id, h.name, h.code, h.gender_type, h.warden_id, h.total_rooms, h.description, h.created_at,
        u.full_name as warden_name, u.phone as warden_phone,
        COUNT(r.id) as configured_rooms,
        IFNULL(SUM(r.capacity), 0) as total_capacity,
        IFNULL(SUM(r.current_occupancy), 0) as current_occupancy,
        IFNULL(SUM(r.capacity - r.current_occupancy), 0) as vacant_beds
      FROM hostels h
      LEFT JOIN users u ON h.warden_id = u.id
      LEFT JOIN rooms r ON h.id = r.hostel_id
      GROUP BY h.id
      ORDER BY h.name ASC
    `);

    return res.json({ success: true, data: hostels });
  } catch (error) {
    next(error);
  }
}

async function getHostelById(req, res, next) {
  try {
    const { id } = req.params;
    const [hostels] = await pool.query(
      `SELECT h.*, u.full_name as warden_name FROM hostels h LEFT JOIN users u ON h.warden_id = u.id WHERE h.id = ?`,
      [id]
    );

    if (hostels.length === 0) {
      return res.status(404).json({ success: false, message: 'Hostel not found.' });
    }

    const [rooms] = await pool.query(
      `SELECT r.*, 
        (r.capacity - r.current_occupancy) as vacant_slots,
        (SELECT COUNT(*) FROM students s WHERE s.room_id = r.id AND s.is_active = 1) as actual_occupants
       FROM rooms r
       WHERE r.hostel_id = ?
       ORDER BY r.floor ASC, r.room_number ASC`,
      [id]
    );

    return res.json({
      success: true,
      hostel: hostels[0],
      rooms
    });
  } catch (error) {
    next(error);
  }
}

async function createHostel(req, res, next) {
  try {
    const { name, code, gender_type = 'BOYS', warden_id, total_rooms = 0, description } = req.body;

    if (!name || !code) {
      return res.status(400).json({ success: false, message: 'Hostel name and code are required.' });
    }

    const [existing] = await pool.query('SELECT id FROM hostels WHERE code = ?', [code.trim().toUpperCase()]);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: `Hostel code '${code}' already exists.` });
    }

    const [result] = await pool.query(
      `INSERT INTO hostels (name, code, gender_type, warden_id, total_rooms, description)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name.trim(), code.trim().toUpperCase(), gender_type, warden_id || null, parseInt(total_rooms, 10), description || null]
    );

    await logAudit({
      userId: req.user ? req.user.id : null,
      actorName: req.user ? req.user.full_name : 'System',
      actorRole: req.user ? req.user.role : 'ADMIN',
      action: 'HOSTEL_CREATED',
      entityType: 'HOSTEL',
      entityId: result.insertId,
      details: `Created hostel ${name} (${code})`,
      ipAddress: req.ip
    });

    return res.status(201).json({
      success: true,
      message: 'Hostel created successfully.',
      hostelId: result.insertId
    });
  } catch (error) {
    next(error);
  }
}

async function getRooms(req, res, next) {
  try {
    const { hostelId, status, floor } = req.query;
    const params = [];
    const conditions = [];

    if (hostelId) {
      conditions.push('r.hostel_id = ?');
      params.push(hostelId);
    }
    if (status) {
      conditions.push('r.status = ?');
      params.push(status);
    }
    if (floor) {
      conditions.push('r.floor = ?');
      params.push(floor);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rooms] = await pool.query(
      `SELECT r.*, h.name as hostel_name, h.code as hostel_code,
        (r.capacity - r.current_occupancy) as vacant_slots
       FROM rooms r
       JOIN hostels h ON r.hostel_id = h.id
       ${where}
       ORDER BY h.name ASC, r.floor ASC, r.room_number ASC`,
      params
    );

    return res.json({ success: true, data: rooms });
  } catch (error) {
    next(error);
  }
}

async function createRoom(req, res, next) {
  try {
    const { hostel_id, room_number, floor = 1, capacity = 4, status = 'AVAILABLE' } = req.body;

    if (!hostel_id || !room_number) {
      return res.status(400).json({ success: false, message: 'Hostel ID and room number are required.' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM rooms WHERE hostel_id = ? AND room_number = ?',
      [hostel_id, room_number.trim()]
    );

    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: `Room ${room_number} already exists in this hostel.` });
    }

    const [result] = await pool.query(
      `INSERT INTO rooms (hostel_id, room_number, floor, capacity, current_occupancy, status)
       VALUES (?, ?, ?, ?, 0, ?)`,
      [hostel_id, room_number.trim(), parseInt(floor, 10), parseInt(capacity, 10), status]
    );

    return res.status(201).json({
      success: true,
      message: 'Room created successfully.',
      roomId: result.insertId
    });
  } catch (error) {
    next(error);
  }
}

async function getWardens(req, res, next) {
  try {
    const [wardens] = await pool.query(
      "SELECT id, full_name, email, phone FROM users WHERE role = 'WARDEN' AND is_active = 1 ORDER BY full_name ASC"
    );
    return res.json({ success: true, data: wardens });
  } catch (error) {
    next(error);
  }
}

async function deleteHostel(req, res, next) {
  try {
    const { id } = req.params;
    const [students] = await pool.query('SELECT COUNT(*) as count FROM students WHERE hostel_id = ?', [id]);
    if (students[0].count > 0) {
      return res.status(400).json({ success: false, message: 'Cannot delete hostel with assigned students. Please reassign students first.' });
    }
    await pool.query('DELETE FROM rooms WHERE hostel_id = ?', [id]);
    await pool.query('DELETE FROM hostels WHERE id = ?', [id]);

    await logAudit({
      userId: req.user ? req.user.id : null,
      actorName: req.user ? req.user.full_name : 'System',
      actorRole: req.user ? req.user.role : 'ADMIN',
      action: 'HOSTEL_DELETED',
      entityType: 'HOSTEL',
      entityId: id,
      details: `Deleted hostel ID ${id}`,
      ipAddress: req.ip
    });

    return res.json({ success: true, message: 'Hostel and its rooms deleted successfully.' });
  } catch (error) {
    next(error);
  }
}

async function deleteRoom(req, res, next) {
  try {
    const { id } = req.params;
    const [students] = await pool.query('SELECT COUNT(*) as count FROM students WHERE room_id = ?', [id]);
    if (students[0].count > 0) {
      return res.status(400).json({ success: false, message: 'Cannot delete room with active occupants.' });
    }
    await pool.query('DELETE FROM rooms WHERE id = ?', [id]);
    return res.json({ success: true, message: 'Room deleted successfully.' });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getHostels,
  getHostelById,
  createHostel,
  getRooms,
  createRoom,
  getWardens,
  deleteHostel,
  deleteRoom
};
