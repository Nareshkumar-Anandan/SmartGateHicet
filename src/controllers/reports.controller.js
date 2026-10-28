const { pool } = require('../config/database');
const { AsyncParser } = require('json2csv');

async function getDailyMovementReport(req, res, next) {
  try {
    const { days = 7 } = req.query;

    const [dailyData] = await pool.query(
      `SELECT 
        DATE(event_timestamp) as log_date,
        SUM(CASE WHEN direction = 'ENTRY' AND access_result = 'GRANTED' THEN 1 ELSE 0 END) as granted_entries,
        SUM(CASE WHEN direction = 'EXIT' AND access_result = 'GRANTED' THEN 1 ELSE 0 END) as granted_exits,
        SUM(CASE WHEN access_result = 'DENIED' THEN 1 ELSE 0 END) as denied_attempts
       FROM gate_events
       WHERE event_timestamp >= CURDATE() - INTERVAL ? DAY
       GROUP BY DATE(event_timestamp)
       ORDER BY log_date ASC`,
      [parseInt(days, 10)]
    );

    return res.json({ success: true, data: dailyData });
  } catch (error) {
    next(error);
  }
}

async function getHeadcountReport(req, res, next) {
  try {
    const [byHostel] = await pool.query(`
      SELECT 
        h.id as hostel_id, h.name as hostel_name, h.code as hostel_code,
        COUNT(s.id) as total_students,
        SUM(CASE WHEN s.current_location_status = 'INSIDE' THEN 1 ELSE 0 END) as students_inside,
        SUM(CASE WHEN s.current_location_status = 'OUTSIDE' THEN 1 ELSE 0 END) as students_outside
      FROM hostels h
      LEFT JOIN students s ON h.id = s.hostel_id AND s.is_active = 1
      GROUP BY h.id
      ORDER BY h.name ASC
    `);

    const [byDept] = await pool.query(`
      SELECT 
        department,
        COUNT(id) as total_students,
        SUM(CASE WHEN current_location_status = 'INSIDE' THEN 1 ELSE 0 END) as students_inside,
        SUM(CASE WHEN current_location_status = 'OUTSIDE' THEN 1 ELSE 0 END) as students_outside
      FROM students
      WHERE is_active = 1
      GROUP BY department
      ORDER BY total_students DESC
    `);

    return res.json({
      success: true,
      byHostel,
      byDept
    });
  } catch (error) {
    next(error);
  }
}

async function getOutingsAnalytics(req, res, next) {
  try {
    const { startDate, endDate } = req.query;
    const conditions = [];
    const params = [];

    if (startDate) {
      conditions.push('departure_date >= ?');
      params.push(startDate);
    }
    if (endDate) {
      conditions.push('departure_date <= ?');
      params.push(endDate);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [[statusSummary]] = await pool.query(`
      SELECT 
        COUNT(*) as total_requests,
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'OVERDUE' THEN 1 ELSE 0 END) as overdue
      FROM outings
      ${where}
    `, params);

    const [typeBreakdown] = await pool.query(`
      SELECT 
        outing_type,
        COUNT(*) as count
      FROM outings
      ${where}
      GROUP BY outing_type
    `, params);

    return res.json({
      success: true,
      summary: statusSummary,
      byType: typeBreakdown
    });
  } catch (error) {
    next(error);
  }
}

async function getDeniedAccessReport(req, res, next) {
  try {
    const { startDate, endDate } = req.query;
    const conditions = ["access_result = 'DENIED'"];
    const params = [];

    if (startDate) {
      conditions.push('event_timestamp >= ?');
      params.push(`${startDate} 00:00:00`);
    }
    if (endDate) {
      conditions.push('event_timestamp <= ?');
      params.push(`${endDate} 23:59:59`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const [events] = await pool.query(`
      SELECT 
        e.id, e.event_timestamp, e.direction, e.verification_type, e.denial_reason, e.event_source,
        s.student_id, s.first_name, s.last_name, s.department,
        d.device_name, d.device_code
      FROM gate_events e
      JOIN gate_devices d ON e.device_id = d.id
      LEFT JOIN students s ON e.student_id = s.id
      ${where}
      ORDER BY e.event_timestamp DESC
      LIMIT 100
    `, params);

    return res.json({ success: true, data: events });
  } catch (error) {
    next(error);
  }
}

async function exportCustomReportCsv(req, res, next) {
  try {
    const { reportType, startDate, endDate } = req.query;

    if (reportType === 'OUTINGS') {
      const [data] = await pool.query(`
        SELECT 
          o.id as 'Outing ID',
          s.student_id as 'Roll Number',
          CONCAT(s.first_name, ' ', s.last_name) as 'Student Name',
          s.department as 'Department',
          o.outing_type as 'Type',
          o.departure_date as 'Departure Date',
          o.departure_time as 'Departure Time',
          o.expected_return_date as 'Expected Return Date',
          o.expected_return_time as 'Expected Return Time',
          IFNULL(o.actual_departure_time, 'N/A') as 'Actual Exit',
          IFNULL(o.actual_return_time, 'N/A') as 'Actual Return',
          o.destination as 'Destination',
          o.status as 'Status',
          IFNULL(u.full_name, 'N/A') as 'Decided By'
        FROM outings o
        JOIN students s ON o.student_id = s.id
        LEFT JOIN users u ON o.approved_by_user_id = u.id
        ORDER BY o.departure_date DESC
        LIMIT 5000
      `);

      const parser = new AsyncParser();
      const csv = await parser.parse(data).promise();
      res.header('Content-Type', 'text/csv');
      res.attachment(`HICET_Outings_Report_${new Date().toISOString().split('T')[0]}.csv`);
      return res.send(csv);
    }

    // Default: Student Headcount
    const [data] = await pool.query(`
      SELECT 
        s.student_id as 'Roll Number',
        CONCAT(s.first_name, ' ', s.last_name) as 'Student Name',
        s.department as 'Department',
        s.course as 'Course',
        s.year_of_study as 'Year',
        s.phone as 'Contact',
        s.parent_phone as 'Parent Contact',
        h.name as 'Hostel',
        r.room_number as 'Room',
        s.current_location_status as 'Location Status',
        s.biometric_device_id as 'Device Biometric ID'
      FROM students s
      LEFT JOIN hostels h ON s.hostel_id = h.id
      LEFT JOIN rooms r ON s.room_id = r.id
      WHERE s.is_active = 1
      ORDER BY s.student_id ASC
    `);

    const parser = new AsyncParser();
    const csv = await parser.parse(data).promise();
    res.header('Content-Type', 'text/csv');
    res.attachment(`HICET_Student_Headcount_${new Date().toISOString().split('T')[0]}.csv`);
    return res.send(csv);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getDailyMovementReport,
  getHeadcountReport,
  getOutingsAnalytics,
  getDeniedAccessReport,
  exportCustomReportCsv
};
