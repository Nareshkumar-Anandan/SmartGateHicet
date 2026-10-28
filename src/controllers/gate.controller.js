const { pool } = require('../config/database');
const eventProcessor = require('../services/eventProcessor');
const deviceManager = require('../services/deviceManager');
const { AsyncParser } = require('json2csv');

async function getGateEvents(req, res, next) {
  try {
    const {
      startDate,
      endDate,
      studentId,
      direction,
      accessResult,
      deviceId,
      eventSource,
      search,
      page = 1,
      limit = 25
    } = req.query;

    const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    const conditions = [];
    const params = [];

    if (startDate) {
      conditions.push('e.event_timestamp >= ?');
      params.push(`${startDate} 00:00:00`);
    }

    if (endDate) {
      conditions.push('e.event_timestamp <= ?');
      params.push(`${endDate} 23:59:59`);
    }

    if (studentId) {
      conditions.push('e.student_id = ?');
      params.push(studentId);
    }

    if (direction) {
      conditions.push('e.direction = ?');
      params.push(direction);
    }

    if (accessResult) {
      conditions.push('e.access_result = ?');
      params.push(accessResult);
    }

    if (deviceId) {
      conditions.push('e.device_id = ?');
      params.push(deviceId);
    }

    if (eventSource) {
      conditions.push('e.event_source = ?');
      params.push(eventSource);
    }

    if (search && search.trim()) {
      conditions.push('(s.student_id LIKE ? OR s.first_name LIKE ? OR s.last_name LIKE ? OR d.device_name LIKE ? OR e.denial_reason LIKE ?)');
      const t = `%${search.trim()}%`;
      params.push(t, t, t, t, t);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Total count
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total 
       FROM gate_events e
       LEFT JOIN students s ON e.student_id = s.id
       JOIN gate_devices d ON e.device_id = d.id
       ${whereClause}`,
      params
    );

    // List query
    const [events] = await pool.query(
      `SELECT 
        e.id, e.event_uuid, e.event_timestamp, e.direction, e.verification_type,
        e.access_result, e.denial_reason, e.event_source, e.processed_status,
        s.id as student_internal_id,
        IFNULL(s.student_id, IF(e.event_source = 'MANUAL', 'ADMIN-PERMISSION', 'GUEST')) as student_roll,
        IFNULL(s.first_name, IF(e.event_source = 'MANUAL', 'Turnstile Permission', 'Unknown')) as first_name,
        IFNULL(s.last_name, IF(e.event_source = 'MANUAL', 'Granted', 'Person')) as last_name,
        IFNULL(s.department, IF(e.event_source = 'MANUAL', 'Manual Barrier Release', 'Gate Access')) as department,
        s.phone as student_phone,
        d.id as gate_device_id, d.device_code, d.device_name, d.location_description,
        o.id as outing_id, o.destination as outing_destination, o.status as outing_status
       FROM gate_events e
       LEFT JOIN students s ON e.student_id = s.id
       JOIN gate_devices d ON e.device_id = d.id
       LEFT JOIN outings o ON e.related_outing_id = o.id
       ${whereClause}
       ORDER BY e.event_timestamp DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit, 10), offset]
    );

    return res.json({
      success: true,
      data: events,
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

async function getLiveFeed(req, res, next) {
  try {
    const { lastId = 0 } = req.query;

    const [events] = await pool.query(
      `SELECT 
        e.id, e.event_uuid, e.event_timestamp, e.direction, e.verification_type,
        e.access_result, e.denial_reason, e.event_source,
        IFNULL(s.student_id, IF(e.event_source = 'MANUAL', 'ADMIN-PERMISSION', 'GUEST')) as student_roll,
        IFNULL(s.first_name, IF(e.event_source = 'MANUAL', 'Turnstile Permission', 'Unknown')) as first_name,
        IFNULL(s.last_name, IF(e.event_source = 'MANUAL', 'Granted', 'Person')) as last_name,
        IFNULL(s.department, IF(e.event_source = 'MANUAL', 'Manual Barrier Release', 'Gate Access')) as department,
        d.device_code, d.device_name
       FROM gate_events e
       LEFT JOIN students s ON e.student_id = s.id
       JOIN gate_devices d ON e.device_id = d.id
       WHERE e.id > ?
       ORDER BY e.id DESC
       LIMIT 15`,
      [parseInt(lastId, 10)]
    );

    return res.json({ success: true, events });
  } catch (error) {
    next(error);
  }
}

async function exportMovementCsv(req, res, next) {
  try {
    const { startDate, endDate, direction, accessResult } = req.query;
    const conditions = [];
    const params = [];

    if (startDate) {
      conditions.push('e.event_timestamp >= ?');
      params.push(`${startDate} 00:00:00`);
    }
    if (endDate) {
      conditions.push('e.event_timestamp <= ?');
      params.push(`${endDate} 23:59:59`);
    }
    if (direction) {
      conditions.push('e.direction = ?');
      params.push(direction);
    }
    if (accessResult) {
      conditions.push('e.access_result = ?');
      params.push(accessResult);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [events] = await pool.query(
      `SELECT 
        e.event_uuid as 'Event UUID',
        e.event_timestamp as 'Timestamp',
        d.device_name as 'Gate Device',
        d.device_code as 'Device Code',
        e.direction as 'Direction',
        e.verification_type as 'Auth Mode',
        e.access_result as 'Access Result',
        IFNULL(e.denial_reason, 'N/A') as 'Denial Reason',
        IFNULL(s.student_id, 'UNREGISTERED') as 'Student ID',
        IFNULL(CONCAT(s.first_name, ' ', s.last_name), 'Unknown') as 'Student Name',
        IFNULL(s.department, 'N/A') as 'Department',
        e.event_source as 'Event Source'
       FROM gate_events e
       LEFT JOIN students s ON e.student_id = s.id
       JOIN gate_devices d ON e.device_id = d.id
       ${where}
       ORDER BY e.event_timestamp DESC
       LIMIT 5000`,
      params
    );

    const parser = new AsyncParser();
    const csv = await parser.parse(events).promise();

    res.header('Content-Type', 'text/csv');
    res.attachment(`HICET_Gate_Movements_${new Date().toISOString().split('T')[0]}.csv`);
    return res.send(csv);
  } catch (error) {
    next(error);
  }
}

/**
 * TimeWatch HTTP PUSH ADMS Callback Endpoint
 * Receives live push transactions from TimeWatch TrueFace3000 terminals
 */
async function handleTimeWatchPushCallback(req, res, next) {
  try {
    const rawPayload = req.body;
    console.log('[TimeWatch PUSH Webhook Received]:', JSON.stringify(rawPayload));

    // Resolve device by serial number
    const sn = rawPayload.sn || rawPayload.serialNumber;
    if (!sn) {
      return res.status(400).send('ERROR: Missing terminal serial number (sn)');
    }

    const adapter = await deviceManager.getAdapter(sn);
    const normalized = adapter.normalizeEvent(rawPayload);
    const decision = await eventProcessor.processEvent(normalized);

    // Return TimeWatch terminal expected response (e.g., OK or ACK)
    return res.status(200).json({
      status: 'SUCCESS',
      accessResult: decision.accessResult,
      barrierUnlocked: decision.relayTriggered
    });
  } catch (error) {
    console.error('TimeWatch push callback error:', error);
    return res.status(500).send('SERVER_ERROR');
  }
}

module.exports = {
  getGateEvents,
  getLiveFeed,
  exportMovementCsv,
  handleTimeWatchPushCallback
};
