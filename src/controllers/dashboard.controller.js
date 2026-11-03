const { pool } = require('../config/database');

async function getAdminSummary(req, res, next) {
  try {
    // 1. Core metric counts
    const [[studentCounts]] = await pool.query(`
      SELECT 
        COUNT(*) as totalStudents,
        SUM(CASE WHEN current_location_status = 'INSIDE' THEN 1 ELSE 0 END) as studentsInside,
        SUM(CASE WHEN current_location_status = 'OUTSIDE' THEN 1 ELSE 0 END) as studentsOutside,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as activeStudents
      FROM students
    `);

    const [[wardenCounts]] = await pool.query(
      "SELECT COUNT(*) as totalWardens FROM users WHERE role = 'WARDEN' AND is_active = 1"
    );

    const [[hostelCounts]] = await pool.query(
      "SELECT COUNT(*) as totalHostels FROM hostels"
    );

    const [[roomCounts]] = await pool.query(`
      SELECT 
        COUNT(*) as totalRooms,
        IFNULL(SUM(capacity), 0) as totalCapacity,
        IFNULL(SUM(current_occupancy), 0) as totalOccupied
      FROM rooms
    `);

    const [[outingCounts]] = await pool.query(`
      SELECT 
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pendingOutings,
        SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) as approvedOutings,
        SUM(CASE WHEN status = 'OVERDUE' THEN 1 ELSE 0 END) as overdueReturns
      FROM outings
    `);

    const [[deviceCounts]] = await pool.query(`
      SELECT 
        COUNT(*) as totalDevices,
        SUM(CASE WHEN last_heartbeat >= NOW() - INTERVAL 300 SECOND AND status = 'ONLINE' THEN 1 ELSE 0 END) as devicesOnline,
        SUM(CASE WHEN last_heartbeat < NOW() - INTERVAL 300 SECOND OR last_heartbeat IS NULL OR status != 'ONLINE' THEN 1 ELSE 0 END) as devicesOffline
      FROM gate_devices
    `);

    // 2. Recent gate activity (last 10)
    const [recentEvents] = await pool.query(`
      SELECT 
        e.id, e.event_uuid, e.event_timestamp, e.direction, e.verification_type,
        e.access_result, e.denial_reason, e.event_source,
        s.student_id, s.first_name, s.last_name, s.department,
        d.device_name, d.device_code
      FROM gate_events e
      JOIN gate_devices d ON e.device_id = d.id
      LEFT JOIN students s ON e.student_id = s.id
      ORDER BY e.event_timestamp DESC
      LIMIT 10
    `);

    // 3. Denied access attempts (last 5)
    const [deniedEvents] = await pool.query(`
      SELECT 
        e.id, e.event_timestamp, e.direction, e.verification_type, e.denial_reason, e.event_source,
        s.student_id, s.first_name, s.last_name,
        d.device_name
      FROM gate_events e
      JOIN gate_devices d ON e.device_id = d.id
      LEFT JOIN students s ON e.student_id = s.id
      WHERE e.access_result = 'DENIED'
      ORDER BY e.event_timestamp DESC
      LIMIT 5
    `);

    // 4. Recent audit actions (last 6)
    const [recentAudits] = await pool.query(`
      SELECT id, actor_name, actor_role, action, entity_type, details, created_at
      FROM audit_logs
      ORDER BY created_at DESC
      LIMIT 6
    `);

    // 5. Hostels occupancy snapshot
    const [hostelsSnapshot] = await pool.query(`
      SELECT 
        h.id, h.name, h.code, h.gender_type,
        COUNT(r.id) as totalRooms,
        IFNULL(SUM(r.capacity), 0) as capacity,
        IFNULL(SUM(r.current_occupancy), 0) as occupancy
      FROM hostels h
      LEFT JOIN rooms r ON h.id = r.hostel_id
      GROUP BY h.id
    `);

    return res.json({
      success: true,
      stats: {
        totalStudents: Number(studentCounts.totalStudents || 0),
        studentsInside: Number(studentCounts.studentsInside || 0),
        studentsOutside: Number(studentCounts.studentsOutside || 0),
        activeStudents: Number(studentCounts.activeStudents || 0),
        totalWardens: Number(wardenCounts.totalWardens || 0),
        totalHostels: Number(hostelCounts.totalHostels || 0),
        totalRooms: Number(roomCounts.totalRooms || 0),
        totalCapacity: Number(roomCounts.totalCapacity || 0),
        totalOccupied: Number(roomCounts.totalOccupied || 0),
        pendingOutings: Number(outingCounts.pendingOutings || 0),
        approvedOutings: Number(outingCounts.approvedOutings || 0),
        overdueReturns: Number(outingCounts.overdueReturns || 0),
        totalDevices: Number(deviceCounts.totalDevices || 0),
        devicesOnline: Number(deviceCounts.devicesOnline || 0),
        devicesOffline: Number(deviceCounts.devicesOffline || 0)
      },
      recentEvents,
      deniedEvents,
      recentAudits,
      hostelsSnapshot
    });
  } catch (error) {
    next(error);
  }
}

async function getWardenSummary(req, res, next) {
  try {
    const [[studentCounts]] = await pool.query(`
      SELECT 
        COUNT(*) as totalStudents,
        SUM(CASE WHEN current_location_status = 'INSIDE' THEN 1 ELSE 0 END) as studentsInside,
        SUM(CASE WHEN current_location_status = 'OUTSIDE' THEN 1 ELSE 0 END) as studentsOutside
      FROM students
      WHERE is_active = 1
    `);

    const [[outingCounts]] = await pool.query(`
      SELECT 
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pendingOutings,
        SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) as approvedOutings,
        SUM(CASE WHEN status = 'OVERDUE' THEN 1 ELSE 0 END) as overdueReturns
      FROM outings
    `);

    // Pending outings queue
    const [pendingQueue] = await pool.query(`
      SELECT 
        o.id, o.outing_type, o.departure_date, o.departure_time, o.expected_return_date, o.expected_return_time,
        o.destination, o.reason, o.status, o.created_at,
        s.student_id, s.first_name, s.last_name, s.department, s.phone,
        h.name as hostel_name, r.room_number
      FROM outings o
      JOIN students s ON o.student_id = s.id
      LEFT JOIN hostels h ON s.hostel_id = h.id
      LEFT JOIN rooms r ON s.room_id = r.id
      WHERE o.status = 'PENDING'
      ORDER BY o.departure_date ASC, o.departure_time ASC
      LIMIT 10
    `);

    // Overdue returns list
    const [overdueList] = await pool.query(`
      SELECT 
        o.id, o.departure_date, o.expected_return_date, o.expected_return_time, o.destination,
        s.student_id, s.first_name, s.last_name, s.department, s.phone, s.parent_phone,
        h.name as hostel_name, r.room_number
      FROM outings o
      JOIN students s ON o.student_id = s.id
      LEFT JOIN hostels h ON s.hostel_id = h.id
      LEFT JOIN rooms r ON s.room_id = r.id
      WHERE o.status = 'OVERDUE' OR (o.status = 'APPROVED' AND CONCAT(o.expected_return_date, ' ', o.expected_return_time) < NOW() AND s.current_location_status = 'OUTSIDE')
      ORDER BY o.expected_return_date ASC, o.expected_return_time ASC
    `);

    // Recent events
    const [recentEvents] = await pool.query(`
      SELECT 
        e.id, e.event_timestamp, e.direction, e.verification_type, e.access_result, e.denial_reason,
        s.student_id, s.first_name, s.last_name, s.department,
        d.device_name
      FROM gate_events e
      JOIN gate_devices d ON e.device_id = d.id
      LEFT JOIN students s ON e.student_id = s.id
      ORDER BY e.event_timestamp DESC
      LIMIT 8
    `);

    // Open incidents
    const [openIncidents] = await pool.query(`
      SELECT i.id, i.incident_type, i.title, i.severity, i.status, i.reported_at,
             s.student_id, s.first_name, s.last_name
      FROM incidents i
      LEFT JOIN students s ON i.student_id = s.id
      WHERE i.status != 'RESOLVED'
      ORDER BY i.reported_at DESC
      LIMIT 5
    `);

    return res.json({
      success: true,
      stats: {
        totalStudents: Number(studentCounts.totalStudents || 0),
        studentsInside: Number(studentCounts.studentsInside || 0),
        studentsOutside: Number(studentCounts.studentsOutside || 0),
        pendingOutings: Number(outingCounts.pendingOutings || 0),
        approvedOutings: Number(outingCounts.approvedOutings || 0),
        overdueReturns: Number(outingCounts.overdueReturns || 0)
      },
      pendingQueue,
      overdueList,
      recentEvents,
      openIncidents
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAdminSummary,
  getWardenSummary
};
