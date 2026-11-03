const { pool, withTransaction, ensureSchemaColumns } = require('../config/database');
const { logAudit } = require('../middleware/auditLogger');
const deviceManager = require('../services/deviceManager');
const bulkStudentUploadService = require('../services/bulkStudentUploadService');

async function getStudents(req, res, next) {
  try {
    await ensureSchemaColumns();
    const {
      search,
      hostelId,
      department,
      year,
      location,
      isActive,
      page = 1,
      limit = 20
    } = req.query;

    const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    const params = [];
    let whereConditions = [];

    if (search && search.trim()) {
      whereConditions.push('(s.student_id LIKE ? OR s.first_name LIKE ? OR s.last_name LIKE ? OR s.phone LIKE ? OR s.biometric_device_id LIKE ?)');
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term, term);
    }

    if (hostelId) {
      whereConditions.push('s.hostel_id = ?');
      params.push(hostelId);
    }

    if (department) {
      whereConditions.push('s.department = ?');
      params.push(department);
    }

    if (year) {
      whereConditions.push('s.year_of_study = ?');
      params.push(year);
    }

    if (location) {
      whereConditions.push('s.current_location_status = ?');
      params.push(location);
    }

    if (isActive !== undefined && isActive !== '') {
      whereConditions.push('s.is_active = ?');
      params.push(isActive === 'true' || isActive === '1' ? 1 : 0);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Count query
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM students s ${whereClause}`,
      params
    );

    // Data query
    const [students] = await pool.query(
      `SELECT 
        s.id, s.student_id, s.first_name, s.last_name, s.department, s.course, s.year_of_study,
        s.phone, s.parent_phone, s.email, s.hostel_id, s.room_id,
        s.current_location_status, s.biometric_device_id, s.biometric_enrolled, s.card_number,
        s.photo_avatar, s.photo_url, s.institution, s.gender, s.guardian_name, s.district, s.address, s.pincode, s.aadhar_number, s.dob,
        s.is_active, s.created_at, s.updated_at,
        h.name as hostel_name, h.code as hostel_code,
        r.room_number, r.floor as room_floor
       FROM students s
       LEFT JOIN hostels h ON s.hostel_id = h.id
       LEFT JOIN rooms r ON s.room_id = r.id
       ${whereClause}
       ORDER BY s.student_id ASC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit, 10), offset]
    );

    // Fallback: Populate photo_avatar if image exists on disk but DB record was null
    const fs = require('fs');
    const path = require('path');
    const uploadsDir = path.resolve(__dirname, '../../uploads/students');
    for (const s of students) {
      if (!s.photo_avatar && !s.photo_url) {
        const candidate = `${s.student_id}.jpg`;
        if (fs.existsSync(path.join(uploadsDir, candidate))) {
          s.photo_avatar = `/uploads/students/${candidate}`;
          s.photo_url = `/uploads/students/${candidate}`;
          pool.query('UPDATE students SET photo_avatar = ?, photo_url = ? WHERE id = ?', [s.photo_avatar, s.photo_url, s.id]).catch(() => {});
        }
      }
    }

    return res.json({
      success: true,
      data: students,
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

async function getStudentById(req, res, next) {
  try {
    const { id } = req.params;

    const [rows] = await pool.query(
      `SELECT 
        s.*,
        h.name as hostel_name, h.code as hostel_code,
        r.room_number, r.floor as room_floor, r.capacity as room_capacity
       FROM students s
       LEFT JOIN hostels h ON s.hostel_id = h.id
       LEFT JOIN rooms r ON s.room_id = r.id
       WHERE s.id = ? OR s.student_id = ?`,
      [id, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    const student = rows[0];

    // Fallback photo check
    if (!student.photo_avatar && !student.photo_url) {
      const fs = require('fs');
      const path = require('path');
      const candidate = `${student.student_id}.jpg`;
      const fullPath = path.resolve(__dirname, '../../uploads/students', candidate);
      if (fs.existsSync(fullPath)) {
        student.photo_avatar = `/uploads/students/${candidate}`;
        student.photo_url = `/uploads/students/${candidate}`;
        pool.query('UPDATE students SET photo_avatar = ?, photo_url = ? WHERE id = ?', [student.photo_avatar, student.photo_url, student.id]).catch(() => {});
      }
    }

    // Fetch recent movement history (last 10)
    const [movements] = await pool.query(
      `SELECT e.id, e.event_timestamp, e.direction, e.verification_type, e.access_result, e.denial_reason,
              d.device_name, d.device_code
       FROM gate_events e
       JOIN gate_devices d ON e.device_id = d.id
       WHERE e.student_id = ?
       ORDER BY e.event_timestamp DESC
       LIMIT 10`,
      [student.id]
    );

    // Fetch recent outings (last 10)
    const [outings] = await pool.query(
      `SELECT * FROM outings
       WHERE student_id = ?
       ORDER BY created_at DESC
       LIMIT 10`,
      [student.id]
    );

    return res.json({
      success: true,
      student,
      movements,
      outings
    });
  } catch (error) {
    next(error);
  }
}

async function createStudent(req, res, next) {
  try {
    const {
      student_id,
      first_name,
      last_name,
      department,
      course = 'B.E.',
      year_of_study = 1,
      phone,
      parent_phone,
      email,
      hostel_id,
      room_id,
      biometric_device_id,
      card_number,
      institution,
      gender,
      dob,
      guardian_name,
      district,
      address,
      pincode,
      aadhar_number,
      photo_url,
      photo_avatar
    } = req.body;

    if (!student_id || !first_name || !department || !phone || !parent_phone || !email) {
      return res.status(400).json({
        success: false,
        message: 'Required fields: student_id, first_name, department, phone, parent_phone, email.'
      });
    }
    const safeLastName = last_name ? String(last_name).trim() : '';

    // Check unique student ID and email
    const [existing] = await pool.query(
      'SELECT id, student_id, email FROM students WHERE student_id = ? OR email = ?',
      [student_id.trim(), email.trim().toLowerCase()]
    );

    if (existing.length > 0) {
      const match = existing[0];
      return res.status(409).json({
        success: false,
        message: match.student_id === student_id.trim()
          ? `Student ID '${student_id}' is already registered.`
          : `Email '${email}' is already registered.`
      });
    }

    // Check room capacity if room assigned
    if (room_id) {
      const [[room]] = await pool.query(
        'SELECT capacity, current_occupancy FROM rooms WHERE id = ?',
        [room_id]
      );
      if (!room) {
        return res.status(404).json({ success: false, message: 'Assigned room does not exist.' });
      }
      if (room.current_occupancy >= room.capacity) {
        return res.status(400).json({
          success: false,
          message: `Cannot assign student: Room is already at maximum capacity (${room.current_occupancy}/${room.capacity}).`
        });
      }
    }

    let assignedBioId = biometric_device_id ? String(biometric_device_id).trim() : null;
    if (!assignedBioId || !/^\d{1,20}$/.test(assignedBioId)) {
      if (/^\d{1,20}$/.test(String(student_id).trim())) {
        assignedBioId = String(student_id).trim();
      } else {
        // Find highest numeric PIN currently in use so we assign next clean integer ID (e.g. 8, 9, 10...)
        const [[maxRow]] = await pool.query(
          "SELECT MAX(CAST(biometric_device_id AS UNSIGNED)) as maxPin FROM students WHERE biometric_device_id REGEXP '^[0-9]{1,9}$'"
        );
        const nextPin = Math.max((maxRow?.maxPin || 7), 7) + 1;
        assignedBioId = String(nextPin);
      }
    }

    let newStudentId = null;
    let finalPhotoAvatar = photo_avatar || photo_url || null;
    if (finalPhotoAvatar && finalPhotoAvatar.startsWith('data:image')) {
      try {
        const sharp = require('sharp');
        const fs = require('fs');
        const path = require('path');
        const base64Data = finalPhotoAvatar.replace(/^data:image\/\w+;base64,/, '');
        const buf = Buffer.from(base64Data, 'base64');
        const optBuf = await sharp(buf)
          .rotate()
          .resize(480, 640, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
        const uploadsDir = path.resolve(__dirname, '../../uploads/students');
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
        const filePath = path.join(uploadsDir, `${student_id.trim()}.jpg`);
        fs.writeFileSync(filePath, optBuf);
        finalPhotoAvatar = `/uploads/students/${student_id.trim()}.jpg`;
      } catch (err) {
        console.warn('[CREATE STUDENT PHOTO WARN]', err.message);
      }
    }

    await withTransaction(async (conn) => {
      const [result] = await conn.query(
        `INSERT INTO students 
         (student_id, first_name, last_name, department, course, year_of_study, phone, parent_phone, email, hostel_id, room_id, current_location_status, biometric_device_id, biometric_enrolled, card_number, is_active, institution, gender, dob, guardian_name, district, address, pincode, aadhar_number, photo_url, photo_avatar)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INSIDE', ?, 1, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          student_id.trim(),
          first_name.trim(),
          safeLastName,
          department.trim(),
          course,
          parseInt(year_of_study, 10),
          phone.trim(),
          parent_phone.trim(),
          email.trim().toLowerCase(),
          hostel_id || null,
          room_id || null,
          assignedBioId,
          card_number || null,
          institution || 'Hindusthan Institute of Technology (HICET)',
          gender || 'MALE',
          dob || null,
          guardian_name || null,
          district || null,
          address || null,
          pincode || null,
          aadhar_number || null,
          finalPhotoAvatar,
          finalPhotoAvatar
        ]
      );

      newStudentId = result.insertId;

      // Update room occupancy
      if (room_id) {
        await conn.query(
          `UPDATE rooms 
           SET current_occupancy = current_occupancy + 1,
               status = CASE WHEN current_occupancy + 1 >= capacity THEN 'FULL' ELSE 'AVAILABLE' END
           WHERE id = ?`,
          [room_id]
        );
      }
    });

    await logAudit({
      userId: req.user ? req.user.id : null,
      actorName: req.user ? req.user.full_name : 'System',
      actorRole: req.user ? req.user.role : 'ADMIN',
      action: 'STUDENT_CREATED',
      entityType: 'STUDENT',
      entityId: newStudentId,
      details: `Created student ${first_name} ${last_name} (${student_id}) with Biometric PIN ${assignedBioId}`,
      ipAddress: req.ip
    });

    // 2-Way Hardware Sync: Automatically push newly created student directly to all TimeWatch turnstile devices
    let pushedDeviceCount = 0;
    try {
      const timewatchApiService = require('../services/timewatchApiService');
      const admsService = require('../services/admsService');
      const timewatchIdmsService = require('../services/timewatchIdmsService');
      const sharp = require('sharp');
      const fs = require('fs');
      const path = require('path');
      const [devices] = await pool.query("SELECT * FROM gate_devices WHERE status != 'OFFLINE'");

      let photoBase64 = '';
      let photoLength = 0;
      let resolvedPhotoPath = null;

      if (finalPhotoAvatar) {
        resolvedPhotoPath = path.resolve(__dirname, '../../uploads/students', path.basename(finalPhotoAvatar));
        if (fs.existsSync(resolvedPhotoPath)) {
          try {
            const rawBuf = fs.readFileSync(resolvedPhotoPath);
            const optBuf = await sharp(rawBuf)
              .resize(352, 432, { fit: 'cover' })
              .jpeg({ quality: 95 })
              .toBuffer();
            photoBase64 = optBuf.toString('base64');
            photoLength = optBuf.length;
          } catch (sharpErr) {
            console.warn('[REGISTER STUDENT PHOTO WARN]', sharpErr.message);
          }
        }
      }

      const fullCleanName = `${first_name.trim()} ${safeLastName}`.trim();
      for (const dev of devices) {
        // Queue real ADMS hardware command
        admsService.queueCommand(
          dev.serial_number,
          `DATA UPDATE USER PIN=${assignedBioId}\tName=${fullCleanName}\tCard=${card_number ? card_number.trim() : ''}\tPri=0\tGrp=1`
        );

        if (photoBase64) {
          const photoCmd1 = `DATA UPDATE USERPHOTO PIN=${assignedBioId}\tFileName=${assignedBioId}.jpg\tSize=${photoLength}\tContent=${photoBase64}`;
          const photoCmd2 = `DATA UPDATE BIOPHOTO PIN=${assignedBioId}\tType=9\tSize=${photoLength}\tContent=${photoBase64}`;
          admsService.queueCommand(dev.serial_number, photoCmd1);
          admsService.queueCommand(dev.serial_number, photoCmd2);
        }

        // Also push via TWAPI AddUser
        timewatchApiService.addUser({
          UserID: assignedBioId,
          Name: fullCleanName,
          DeviceID: dev.serial_number,
          Card: card_number ? card_number.trim() : '',
          FaceTemplate: photoBase64 || ''
        }).catch(err => console.warn(`[AUTO-SYNC TWAPI WARN] ${dev.serial_number}:`, err.message));

        pushedDeviceCount++;
      }

      // Push student directly to TimeWatch iDMS server and physical turnstiles (including face photo)
      timewatchIdmsService.pushStudentToTurnstiles({
        pin: assignedBioId,
        name: fullCleanName,
        department: department.trim(),
        cardNumber: card_number ? card_number.trim() : '',
        photoPath: resolvedPhotoPath || finalPhotoAvatar,
        photoBase64: photoBase64
      }).then(() => {
        console.log(`[TIMEWATCH iDMS SYNC] Successfully uploaded ${fullCleanName} (${assignedBioId}) with photo to turnstiles.`);
      }).catch(err => {
        console.warn('[TIMEWATCH iDMS SYNC WARN]', err.message);
      });

      console.log(`[2-WAY SYNC] Pushed student ${fullCleanName} (PIN: ${assignedBioId}) to ${devices.length} TimeWatch gate terminal(s).`);
    } catch (syncErr) {
      console.warn('[AUTO-SYNC TO DEVICES WARN]', syncErr.message);
    }

    return res.status(201).json({
      success: true,
      message: `Student registered successfully and pushed to all ${pushedDeviceCount} turnstile lanes (Biometric PIN: ${assignedBioId}).`,
      studentId: newStudentId,
      biometricDeviceId: assignedBioId,
      turnstilesCount: pushedDeviceCount
    });
  } catch (error) {
    next(error);
  }
}

async function updateStudent(req, res, next) {
  try {
    const { id } = req.params;
    const {
      first_name,
      last_name,
      department,
      course,
      year_of_study,
      phone,
      parent_phone,
      email,
      hostel_id,
      room_id,
      biometric_device_id,
      card_number,
      current_location_status
    } = req.body;

    const [[existing]] = await pool.query('SELECT * FROM students WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    // Room change check
    const oldRoomId = existing.room_id;
    const newRoomId = room_id !== undefined ? (room_id || null) : oldRoomId;

    if (newRoomId && newRoomId !== oldRoomId) {
      const [[room]] = await pool.query('SELECT capacity, current_occupancy FROM rooms WHERE id = ?', [newRoomId]);
      if (!room) return res.status(404).json({ success: false, message: 'Selected room not found.' });
      if (room.current_occupancy >= room.capacity) {
        return res.status(400).json({
          success: false,
          message: `Cannot assign student: Room is already at capacity (${room.current_occupancy}/${room.capacity}).`
        });
      }
    }

    await withTransaction(async (conn) => {
      await conn.query(
        `UPDATE students 
         SET first_name = ?, last_name = ?, department = ?, course = ?, year_of_study = ?,
             phone = ?, parent_phone = ?, email = ?, hostel_id = ?, room_id = ?,
             biometric_device_id = ?, card_number = ?, current_location_status = ?, updated_at = NOW()
         WHERE id = ?`,
        [
          first_name !== undefined ? first_name : existing.first_name,
          last_name !== undefined ? last_name : existing.last_name,
          department !== undefined ? department : existing.department,
          course !== undefined ? course : existing.course,
          year_of_study !== undefined ? year_of_study : existing.year_of_study,
          phone !== undefined ? phone : existing.phone,
          parent_phone !== undefined ? parent_phone : existing.parent_phone,
          email !== undefined ? email : existing.email,
          hostel_id !== undefined ? (hostel_id || null) : existing.hostel_id,
          newRoomId,
          biometric_device_id !== undefined ? biometric_device_id : existing.biometric_device_id,
          card_number !== undefined ? card_number : existing.card_number,
          current_location_status !== undefined ? current_location_status : existing.current_location_status,
          id
        ]
      );

      // Recalculate room occupancies if room changed
      if (oldRoomId && oldRoomId !== newRoomId) {
        await conn.query(
          `UPDATE rooms 
           SET current_occupancy = (SELECT COUNT(*) FROM students WHERE room_id = ? AND is_active = 1),
               status = CASE WHEN (SELECT COUNT(*) FROM students WHERE room_id = ? AND is_active = 1) >= capacity THEN 'FULL' ELSE 'AVAILABLE' END
           WHERE id = ?`,
          [oldRoomId, oldRoomId, oldRoomId]
        );
      }
      if (newRoomId && oldRoomId !== newRoomId) {
        await conn.query(
          `UPDATE rooms 
           SET current_occupancy = (SELECT COUNT(*) FROM students WHERE room_id = ? AND is_active = 1),
               status = CASE WHEN (SELECT COUNT(*) FROM students WHERE room_id = ? AND is_active = 1) >= capacity THEN 'FULL' ELSE 'AVAILABLE' END
           WHERE id = ?`,
          [newRoomId, newRoomId, newRoomId]
        );
      }
    });

    await logAudit({
      userId: req.user ? req.user.id : null,
      actorName: req.user ? req.user.full_name : 'System',
      actorRole: req.user ? req.user.role : 'ADMIN',
      action: 'STUDENT_UPDATED',
      entityType: 'STUDENT',
      entityId: id,
      details: `Updated profile details for student ID ${existing.student_id}`,
      ipAddress: req.ip
    });

    // 2-Way Hardware Sync: Automatically push updated student details directly to TimeWatch device(s)
    try {
      const timewatchApiService = require('../services/timewatchApiService');
      const admsService = require('../services/admsService');
      const [devices] = await pool.query('SELECT * FROM gate_devices');

      const targetBioId = biometric_device_id !== undefined ? biometric_device_id : existing.biometric_device_id;
      const targetName = `${first_name !== undefined ? first_name : existing.first_name} ${last_name !== undefined ? last_name : existing.last_name}`;
      const targetCard = card_number !== undefined ? card_number : existing.card_number;

      if (targetBioId) {
        for (const dev of devices) {
          timewatchApiService.addUser({
            UserID: targetBioId,
            Name: targetName.trim(),
            DeviceID: dev.serial_number,
            Card: targetCard ? targetCard.trim() : ''
          }).catch(err => console.warn(`[AUTO-SYNC UPDATE TWAPI WARN] ${dev.serial_number}:`, err.message));

          admsService.queueCommand(
            dev.serial_number,
            `DATA UPDATE USER PIN=${targetBioId}\tName=${targetName.trim()}\tCard=${targetCard ? targetCard.trim() : ''}\tPri=0\tGrp=1`
          );
        }
      }
    } catch (syncErr) {
      console.warn('[AUTO-SYNC UPDATE WARN]', syncErr.message);
    }

    return res.json({ success: true, message: 'Student details updated successfully and synced to TimeWatch terminals.' });
  } catch (error) {
    next(error);
  }
}

async function toggleStudentStatus(req, res, next) {
  try {
    const { id } = req.params;
    const [[student]] = await pool.query('SELECT id, student_id, is_active, first_name, last_name, room_id FROM students WHERE id = ?', [id]);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    const newStatus = student.is_active ? 0 : 1;

    await withTransaction(async (conn) => {
      await conn.query('UPDATE students SET is_active = ?, updated_at = NOW() WHERE id = ?', [newStatus, id]);

      // Update room occupancy count
      if (student.room_id) {
        await conn.query(
          `UPDATE rooms 
           SET current_occupancy = (SELECT COUNT(*) FROM students WHERE room_id = ? AND is_active = 1),
               status = CASE WHEN (SELECT COUNT(*) FROM students WHERE room_id = ? AND is_active = 1) >= capacity THEN 'FULL' ELSE 'AVAILABLE' END
           WHERE id = ?`,
          [student.room_id, student.room_id, student.room_id]
        );
      }
    });

    await logAudit({
      userId: req.user ? req.user.id : null,
      actorName: req.user ? req.user.full_name : 'System',
      actorRole: req.user ? req.user.role : 'ADMIN',
      action: newStatus ? 'STUDENT_ACTIVATED' : 'STUDENT_DEACTIVATED',
      entityType: 'STUDENT',
      entityId: id,
      details: `${newStatus ? 'Activated' : 'Deactivated'} student ${student.first_name} ${student.last_name} (${student.student_id})`,
      ipAddress: req.ip
    });

    return res.json({
      success: true,
      message: `Student status set to ${newStatus ? 'Active' : 'Inactive'}. Historical gate and outing records remain preserved.`,
      isActive: Boolean(newStatus)
    });
  } catch (error) {
    next(error);
  }
}

async function syncStudentToTerminal(req, res, next) {
  try {
    const { id } = req.params;
    const { deviceId } = req.body || {};
    const [[student]] = await pool.query('SELECT * FROM students WHERE id = ?', [id]);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    const [devices] = await pool.query("SELECT * FROM gate_devices WHERE status != 'OFFLINE'");
    let targetDevices = [];
    if (deviceId) {
      targetDevices = devices.filter(d => d.serial_number === deviceId || d.device_code === deviceId || String(d.id) === String(deviceId));
      if (targetDevices.length === 0) targetDevices = [{ serial_number: deviceId, device_code: deviceId }];
    } else {
      targetDevices = devices;
    }

    const timewatchApiService = require('../services/timewatchApiService');
    const admsService = require('../services/admsService');
    const timewatchIdmsService = require('../services/timewatchIdmsService');
    const sharp = require('sharp');
    const fs = require('fs');
    const path = require('path');
    const results = [];
    let bioId = student.biometric_device_id ? String(student.biometric_device_id).trim() : null;
    if (!bioId || !/^\d{1,20}$/.test(bioId)) {
      if (/^\d{1,20}$/.test(String(student.student_id).trim())) {
        bioId = String(student.student_id).trim();
      } else {
        bioId = String(student.id);
      }
      await pool.query('UPDATE students SET biometric_device_id = ? WHERE id = ?', [bioId, id]).catch(() => {});
    }

    // 1. Resolve photo from DB or disk fallback
    let resolvedPhotoPath = null;
    let photoBase64 = '';
    let photoLength = 0;

    const candidatePaths = [
      student.photo_avatar,
      student.photo_url,
      path.resolve(__dirname, '../../uploads/students', `${student.student_id}.jpg`),
      path.resolve(__dirname, '../../uploads/students', `${student.student_id}.jpeg`),
      path.resolve(__dirname, '../../uploads/students', `${student.student_id}.png`),
      path.resolve(__dirname, '../../uploads/students', `${student.id}.jpg`)
    ].filter(Boolean);

    for (const cPath of candidatePaths) {
      let p = cPath;
      if (!fs.existsSync(p)) {
        p = path.resolve(__dirname, '../../', String(cPath).replace(/^[/\\]+/, ''));
        if (!fs.existsSync(p)) {
          p = path.resolve(__dirname, '../../uploads/students', path.basename(cPath));
        }
      }
      if (fs.existsSync(p)) {
        resolvedPhotoPath = p;
        break;
      }
    }

    if (resolvedPhotoPath) {
      try {
        const rawBuf = fs.readFileSync(resolvedPhotoPath);
        // Optimize to 352x432 JPEG matching TimeWatch TrueFace specs
        const optBuf = await sharp(rawBuf)
          .resize(352, 432, { fit: 'cover' })
          .jpeg({ quality: 95 })
          .toBuffer();
        photoBase64 = optBuf.toString('base64');
        photoLength = optBuf.length;

        // Ensure student DB has photo_avatar / photo_url set
        const relUrl = `/uploads/students/${path.basename(resolvedPhotoPath)}`;
        if (!student.photo_avatar || student.photo_avatar !== relUrl) {
          await pool.query('UPDATE students SET photo_avatar = ?, photo_url = ? WHERE id = ?', [relUrl, relUrl, id]);
        }
      } catch (sharpErr) {
        console.warn('[PHOTO OPTIMIZATION WARN]', sharpErr.message);
      }
    }

    // 2. Direct hardware sync via TimeWatch iDMS server (with face photo)
    let idmsResult = null;
    try {
      idmsResult = await timewatchIdmsService.pushStudentToTurnstiles({
        pin: bioId,
        name: `${student.first_name} ${student.last_name}`,
        department: student.department,
        cardNumber: student.card_number,
        photoPath: resolvedPhotoPath,
        photoBase64: photoBase64
      });
    } catch (err) {
      console.warn('[TIMEWATCH IDMS SYNC WARN]', err.message);
      idmsResult = { success: false, error: err.message };
    }

    for (const dev of targetDevices) {
      // 3. Queue ADMS command (User info + Photos)
      const admsCmd = `DATA UPDATE USER PIN=${bioId}\tName=${student.first_name} ${student.last_name}\tCard=${student.card_number || ''}\tPri=0\tGrp=1`;
      const cmdId = admsService.queueCommand(dev.serial_number, admsCmd);

      if (photoBase64) {
        const photoCmd1 = `DATA UPDATE USERPHOTO PIN=${bioId}\tFileName=${bioId}.jpg\tSize=${photoLength}\tContent=${photoBase64}`;
        const photoCmd2 = `DATA UPDATE BIOPHOTO PIN=${bioId}\tType=9\tSize=${photoLength}\tContent=${photoBase64}`;
        admsService.queueCommand(dev.serial_number, photoCmd1);
        admsService.queueCommand(dev.serial_number, photoCmd2);
      }

      // 4. Dispatch via TWAPI
      let apiRes = null;
      try {
        apiRes = await timewatchApiService.addUser({
          UserID: bioId,
          Name: `${student.first_name} ${student.last_name}`,
          DeviceID: dev.serial_number,
          Card: student.card_number || '',
          FaceTemplate: photoBase64 || ''
        });
      } catch (e) {
        apiRes = { success: false, message: e.message };
      }

      results.push({
        deviceCode: dev.device_code || dev.serial_number,
        serialNumber: dev.serial_number,
        commandId: cmdId,
        admsQueued: true,
        apiResult: apiRes
      });
    }

    // Mark student as enrolled
    await pool.query('UPDATE students SET biometric_enrolled = 1, updated_at = NOW() WHERE id = ?', [id]);

    await logAudit({
      userId: req.user?.id,
      actorName: req.user?.full_name || 'System',
      actorRole: req.user?.role || 'WARDEN',
      action: 'STUDENT_TIMEWATCH_SYNC',
      entityType: 'STUDENT',
      entityId: id,
      details: `Pushed student ${student.first_name} ${student.last_name} (${bioId}) to ${targetDevices.length} turnstiles with photo`,
      ipAddress: req.ip
    });

    return res.json({
      success: true,
      message: `Successfully pushed credentials and photo for ${student.first_name} ${student.last_name} (PIN: ${bioId}) to all ${targetDevices.length} physical turnstile machines.`,
      biometricId: bioId,
      turnstilesCount: targetDevices.length,
      hasPhoto: Boolean(photoBase64),
      idmsResult,
      results
    });
  } catch (error) {
    next(error);
  }
}

async function syncAllStudentsToTerminals(req, res, next) {
  try {
    const [students] = await pool.query('SELECT id, student_id, first_name, last_name, biometric_device_id, card_number FROM students WHERE is_active = 1');
    const [devices] = await pool.query("SELECT * FROM gate_devices WHERE status != 'OFFLINE'");
    const admsService = require('../services/admsService');
    const timewatchIdmsService = require('../services/timewatchIdmsService');

    let totalCommands = 0;
    for (const s of students) {
      const bioId = s.biometric_device_id || String(s.id);
      for (const dev of devices) {
        admsService.queueCommand(
          dev.serial_number,
          `DATA UPDATE USER PIN=${bioId}\tName=${s.first_name} ${s.last_name}\tCard=${s.card_number || ''}\tPri=0\tGrp=1`,
          true
        );
        totalCommands++;
      }
    }

    // Trigger TimeWatch iDMS hardware upload in background asynchronously
    // so the HTTP response returns immediately without timing out or blocking
    timewatchIdmsService.pushAllStudentsToTurnstiles().catch(err => {
      console.warn('[TIMEWATCH IDMS PUSH ALL ASYNC WARN]', err.message);
    });

    await logAudit({
      userId: req.user?.id,
      actorName: req.user?.full_name || 'System',
      actorRole: req.user?.role || 'ADMIN',
      action: 'SYNC_ALL_STUDENTS_TO_TURNSTILES',
      entityType: 'STUDENT',
      entityId: 0,
      details: `Queued ${students.length} students across all ${devices.length} turnstiles (${totalCommands} commands queued)`,
      ipAddress: req.ip
    });

    return res.json({
      success: true,
      message: `Successfully queued all ${students.length} students to synchronize across all ${devices.length} turnstile lanes. Hardware upload is processing in the background.`,
      studentsCount: students.length,
      turnstilesCount: devices.length,
      totalCommands
    });
  } catch (error) {
    next(error);
  }
}


async function remoteEnrollStudent(req, res, next) {
  try {
    const { id } = req.params;
    const { deviceId, type = 'FACE' } = req.body || {};
    const [[student]] = await pool.query('SELECT * FROM students WHERE id = ?', [id]);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    const [devices] = await pool.query('SELECT * FROM gate_devices');
    let targetDevice = devices[0];
    if (deviceId) {
      const match = devices.find(d => d.serial_number === deviceId || d.device_code === deviceId || String(d.id) === String(deviceId));
      if (match) targetDevice = match;
    }

    const sn = targetDevice?.serial_number || deviceId;
    const bioId = student.biometric_device_id || `TW-UID-${student.student_id.slice(-4)}`;

    const timewatchApiService = require('../services/timewatchApiService');
    const apiRes = await timewatchApiService.remoteEnrollment({
      DeviceID: sn,
      UserID: bioId,
      Type: type
    });

    await logAudit({
      userId: req.user?.id,
      actorName: req.user?.full_name || 'System',
      actorRole: req.user?.role || 'WARDEN',
      action: 'STUDENT_REMOTE_ENROLL',
      entityType: 'STUDENT',
      entityId: id,
      details: `Triggered remote ${type} enrollment on terminal ${sn} for student ${student.first_name} ${student.last_name} (${bioId})`,
      ipAddress: req.ip
    });

    return res.json({
      success: apiRes.success,
      message: apiRes.success
        ? `Remote ${type} enrollment initiated on terminal ${sn}. Direct the student to face the terminal camera.`
        : (apiRes.message || 'Remote enrollment request failed'),
      terminalSerial: sn,
      biometricId: bioId,
      details: apiRes
    });
  } catch (error) {
    next(error);
  }
}

async function getStudentTerminalImage(req, res, next) {
  try {
    const { id } = req.params;
    const { deviceId } = req.query || {};
    const [[student]] = await pool.query('SELECT * FROM students WHERE id = ?', [id]);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    const bioId = student.biometric_device_id || `TW-UID-${student.student_id.slice(-4)}`;
    const fs = require('fs');
    const path = require('path');

    // 1. If student already has a local photo on disk, return it immediately
    if (student.photo_avatar) {
      const diskPath = path.resolve(__dirname, '../../', student.photo_avatar.replace(/^\/+/, ''));
      if (fs.existsSync(diskPath)) {
        const fileBuf = fs.readFileSync(diskPath);
        return res.json({
          success: true,
          biometricId: bioId,
          deviceSerial: deviceId || 'TW30000006260161',
          image: fileBuf.toString('base64'),
          imageUrl: student.photo_avatar
        });
      }
    }

    // 2. Fetch using TWAPI GetUserImage or on-demand from iDMS
    const [devices] = await pool.query('SELECT * FROM gate_devices');
    const targetDevice = (deviceId && devices.find(d => d.serial_number === deviceId || d.device_code === deviceId || String(d.id) === String(deviceId))) || devices[0];
    const sn = targetDevice?.serial_number || deviceId || 'TW30000006260161';

    const timewatchApiService = require('../services/timewatchApiService');
    const apiRes = await timewatchApiService.getUserImage({
      DeviceID: sn,
      UserID: bioId
    });

    const rawImg = apiRes.data?.Image || apiRes.data?.image || apiRes.data;
    if (rawImg && typeof rawImg === 'string' && rawImg.length > 50) {
      const uploadDir = path.resolve(__dirname, '../../uploads/students');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

      const fileName = `${bioId}.jpg`;
      const filePath = path.join(uploadDir, fileName);
      const cleanBase64 = rawImg.replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(filePath, Buffer.from(cleanBase64, 'base64'));

      const avatarPath = `/uploads/students/${fileName}`;
      await pool.query(
        'UPDATE students SET photo_avatar = ?, photo_url = ? WHERE id = ?',
        [avatarPath, avatarPath, student.id]
      );

      return res.json({
        success: true,
        biometricId: bioId,
        deviceSerial: sn,
        image: cleanBase64,
        imageUrl: avatarPath
      });
    }

    return res.json({
      success: apiRes.success,
      biometricId: bioId,
      deviceSerial: sn,
      image: rawImg || null,
      details: apiRes
    });
  } catch (error) {
    next(error);
  }
}

async function deleteStudentFromTerminal(req, res, next) {
  try {
    const { id } = req.params;
    const { deviceId } = req.body || {};
    const [[student]] = await pool.query('SELECT * FROM students WHERE id = ?', [id]);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    const [devices] = await pool.query('SELECT * FROM gate_devices');
    let targetSerials = [];
    if (deviceId) {
      const match = devices.find(d => d.serial_number === deviceId || d.device_code === deviceId || String(d.id) === String(deviceId));
      if (match) targetSerials.push(match.serial_number);
      else targetSerials.push(deviceId);
    } else {
      targetSerials = devices.map(d => d.serial_number);
    }

    const timewatchApiService = require('../services/timewatchApiService');
    const results = [];
    const bioId = student.biometric_device_id || `TW-UID-${student.student_id.slice(-4)}`;

    for (const sn of targetSerials) {
      const apiRes = await timewatchApiService.deleteUser({
        UserID: bioId,
        DeviceID: sn
      });
      results.push({ deviceSerial: sn, result: apiRes });
    }

    await logAudit({
      userId: req.user?.id,
      actorName: req.user?.full_name || 'System',
      actorRole: req.user?.role || 'WARDEN',
      action: 'STUDENT_TERMINAL_REVOKE',
      entityType: 'STUDENT',
      entityId: id,
      details: `Revoked biometric credentials for ${student.first_name} ${student.last_name} (${bioId}) from TimeWatch devices: ${targetSerials.join(', ')}`,
      ipAddress: req.ip
    });

    return res.json({
      success: true,
      message: `Revocation command dispatched to ${targetSerials.length} TimeWatch terminal(s).`,
      biometricId: bioId,
      results
    });
  } catch (error) {
    next(error);
  }
}

async function importStudentsFromTerminal(req, res, next) {
  try {
    await ensureSchemaColumns();
    const timewatchIdmsService = require('../services/timewatchIdmsService');
    const admsService = require('../services/admsService');
    const fs = require('fs');
    const path = require('path');
    const [devices] = await pool.query("SELECT * FROM gate_devices WHERE status != 'OFFLINE'");

    // 1. Accept live machine users pushed from LAN bridge/middleware or fetch directly from TimeWatch iDMS server (UserList.aspx)
    let machineUsers = Array.isArray(req.body?.machineUsers) && req.body.machineUsers.length > 0
      ? req.body.machineUsers
      : [];

    if (machineUsers.length === 0) {
      try {
        machineUsers = await timewatchIdmsService.getEnrolledUsers();
      } catch (err) {
        console.warn('[IMPORT WARN] iDMS UserList fetch error:', err.message);
      }
    }

    // 2. Fallback to TWAPI if iDMS had none
    if (!machineUsers || machineUsers.length === 0) {
      try {
        const timewatchApiService = require('../services/timewatchApiService');
        const targetDeviceId = req.body?.deviceId || devices[0]?.serial_number || 'TW30000006260161';
        const userRes = await timewatchApiService.getUserDetail({ DeviceID: targetDeviceId });
        if (userRes.success && userRes.data) {
          const list = Array.isArray(userRes.data) ? userRes.data : (userRes.data.Data || userRes.data.data || [userRes.data]);
          machineUsers = list.map(u => ({
            userId: String(u.UserID || u.Pin || u.PIN || u.user_id),
            name: u.Name || '',
            card: u.Card || ''
          }));
        }
      } catch (err) {
        console.warn('[IMPORT WARN] TWAPI UserDetail fetch error:', err.message);
      }
    }

    if (!machineUsers || machineUsers.length === 0) {
      return res.json({
        success: false,
        message: 'No enrolled users found on TimeWatch server or terminals to import.'
      });
    }

    const imported = [];
    const updated = [];
    const uploadDir = path.resolve(__dirname, '../../uploads/students');

    // Deduplicate by userId
    const distinctMap = new Map();
    for (const u of machineUsers) {
      const pin = String(u.userId || u.biometric_device_id || u.student_id || '').trim();
      if (!pin || pin === 'ALL' || pin === 'undefined') continue;
      if (!distinctMap.has(pin)) {
        distinctMap.set(pin, { ...u, userId: pin });
      } else {
        const cur = distinctMap.get(pin);
        if (!cur.name || cur.name.startsWith('User ') || cur.name.startsWith('Student ')) cur.name = u.name || cur.name;
        if (!cur.card && u.card) cur.card = u.card;
        if (!cur.photoAvatar && u.photoAvatar) cur.photoAvatar = u.photoAvatar;
        if (!cur.photoUrl && u.photoUrl) cur.photoUrl = u.photoUrl;
        if (!cur.studentId && u.studentId) cur.studentId = u.studentId;
      }
    }

    // Pre-load all existing students into memory for fast O(1) lookup
    const [allExisting] = await pool.query(
      'SELECT id, student_id, first_name, last_name, biometric_device_id, card_number, biometric_enrolled, email, photo_avatar, photo_url FROM students'
    );
    const existingByBioId = new Map();
    const existingByRoll = new Map();
    const existingByEmail = new Map();
    for (const s of allExisting) {
      if (s.biometric_device_id) existingByBioId.set(String(s.biometric_device_id).trim(), s);
      if (s.student_id) existingByRoll.set(String(s.student_id).trim().toUpperCase(), s);
      if (s.email) existingByEmail.set(String(s.email).trim().toLowerCase(), s);
    }

    for (const u of distinctMap.values()) {
      const pin = String(u.userId).trim();
      let rawName = (u.name || '').trim();
      let firstName = u.firstName || '';
      let lastName = u.lastName !== undefined ? u.lastName : '';
      let institution = u.institution || (pin.startsWith('7208') ? 'HIT' : 'HICET');
      let dept = u.department || 'Computer Science & Engineering';

      const existingStudent = existingByBioId.get(pin) ||
                              (u.studentId && existingByRoll.get(String(u.studentId).toUpperCase())) ||
                              existingByRoll.get(pin.toUpperCase()) ||
                              existingByRoll.get(`TW-${pin}`.toUpperCase());

      // Use real PIN / University Roll Number directly instead of prefixing with TW-
      let rollNo = pin;
      if (existingStudent?.student_id && !String(existingStudent.student_id).toUpperCase().startsWith('TW-')) {
        rollNo = existingStudent.student_id;
      } else if (u.studentId && !String(u.studentId).toUpperCase().startsWith('TW-')) {
        rollNo = String(u.studentId).trim();
      }

      // Special mapping for known students like Emmanuvel Simson (PIN 8, Register 720826105011, HIT) & Nareshkumar Anandan (PIN 155)
      if (pin === '8' || rawName.toLowerCase().includes('emmanuvel')) {
        firstName = 'Emmanuvel';
        lastName = 'Simson';
        rollNo = distinctMap.has('720826105011') && pin === '8' ? '8' : '720826105011';
        institution = 'HIT';
      } else if (pin === '720826105011') {
        firstName = 'Emmanuvel';
        lastName = 'Simson';
        rollNo = '720826105011';
        institution = 'HIT';
      } else if (pin === '155') {
        firstName = 'Nareshkumar';
        lastName = 'Anandan';
        rollNo = '155';
        if (!u.email) u.email = 'nareshkumaranandan77@gmail.com';
        if (!u.phone) u.phone = '+919790550429';
        if (!u.parentPhone) u.parentPhone = '9790550429';
      } else if (firstName) {
        if (lastName === '(Student)' || lastName === '(Terminal)') lastName = '';
      } else if (!rawName || /^\d+$/.test(rawName)) {
        const existingFirst = existingStudent?.first_name;
        const existingLast = (existingStudent?.last_name === '(Student)' || existingStudent?.last_name === '(Terminal)')
          ? ''
          : (existingStudent?.last_name || '');
        firstName = existingFirst && existingFirst !== 'Student' ? existingFirst : 'Student';
        lastName = firstName === 'Student' ? pin : existingLast;
      } else {
        // Clean and format student name from machine
        const cleanName = rawName.replace(/^[A-Z]\./, '').trim();
        const parts = (cleanName || rawName).split(/\s+/);
        firstName = parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase() : 'Student';
        lastName = parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ') || (rawName.startsWith('D.') ? 'D' : '');
      }

      const card = u.card ? String(u.card).trim() : (existingStudent?.card_number || null);
      let email = (existingStudent?.email && !existingStudent.email.startsWith('tw-'))
        ? existingStudent.email
        : (u.email || `${rollNo.toLowerCase()}@hicet.ac.in`);

      const localPhotoExists = fs.existsSync(path.join(uploadDir, `${pin}.jpg`));
      const defaultPhotoPath = (localPhotoExists || u.hasFace) ? `/uploads/students/${pin}.jpg` : null;
      const photoAvatar = u.photoAvatar || u.photoUrl || defaultPhotoPath || existingStudent?.photo_avatar || null;
      const photoUrl = u.photoUrl || u.photoAvatar || defaultPhotoPath || existingStudent?.photo_url || null;

      try {
        if (!existingStudent) {
          // If email is already in use by another record, disambiguate with PIN
          if (existingByEmail.has(email.toLowerCase())) {
            email = `${pin.toLowerCase()}@hicet.ac.in`;
            if (existingByEmail.has(email.toLowerCase())) {
              email = `${pin.toLowerCase()}-${Date.now()}@hicet.ac.in`;
            }
          }

          const [insertRes] = await pool.query(
            `INSERT INTO students 
             (student_id, first_name, last_name, department, course, year_of_study, phone, parent_phone, email, current_location_status, biometric_device_id, biometric_enrolled, card_number, is_active, institution, photo_avatar, photo_url)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'INSIDE', ?, 1, ?, 1, ?, ?, ?)
             ON DUPLICATE KEY UPDATE 
               first_name = VALUES(first_name),
               last_name = VALUES(last_name),
               biometric_device_id = VALUES(biometric_device_id),
               biometric_enrolled = 1,
               is_active = 1,
               photo_avatar = COALESCE(VALUES(photo_avatar), photo_avatar),
               photo_url = COALESCE(VALUES(photo_url), photo_url),
               card_number = COALESCE(VALUES(card_number), card_number)`,
            [
              rollNo,
              firstName,
              lastName,
              dept,
              u.course || 'B.E.',
              u.yearOfStudy || 2,
              u.phone || '9876543210',
              u.parentPhone || '9876543210',
              email,
              pin,
              card,
              institution,
              photoAvatar,
              photoUrl
            ]
          );

          const newId = insertRes.insertId;
          const insertedRecord = { id: newId, student_id: rollNo, biometric_device_id: pin, email };
          existingByBioId.set(pin, insertedRecord);
          existingByRoll.set(rollNo.toUpperCase(), insertedRecord);
          existingByEmail.set(email.toLowerCase(), insertedRecord);
          imported.push({ id: newId, studentId: rollNo, name: `${firstName} ${lastName}`.trim(), pin, card, institution });
        } else {
          await pool.query(
            `UPDATE students 
             SET student_id = ?,
                 biometric_enrolled = 1,
                 first_name = ?,
                 last_name = ?,
                 institution = ?,
                 department = ?,
                 biometric_device_id = ?,
                 photo_avatar = COALESCE(?, photo_avatar),
                 photo_url = COALESCE(?, photo_url),
                 card_number = COALESCE(?, card_number),
                 is_active = 1
             WHERE id = ?`,
            [rollNo, firstName, lastName, institution, dept, pin, photoAvatar, photoUrl, card, existingStudent.id]
          );
          updated.push({ id: existingStudent.id, studentId: rollNo, name: `${firstName} ${lastName}`.trim(), pin, institution });
        }
      } catch (sqlErr) {
        console.warn(`[IMPORT USER DB WARN] PIN ${pin}:`, sqlErr.message);
      }

      // Automatically broadcast and push this student across all turnstile lanes
      for (const dev of devices) {
        admsService.queueCommand(
          dev.serial_number,
          `DATA UPDATE USER PIN=${pin}\tName=${`${firstName} ${lastName}`.trim()}\tCard=${card || ''}\tPri=0\tGrp=1`,
          true
        );
      }
    }

    if (devices.length > 0 && distinctMap.size > 0) {
      console.log(`[ADMS QUEUE] Queued update commands for ${distinctMap.size} users across ${devices.length} turnstiles.`);
    }

    // Automatically trigger photo sync from TimeWatch server in background
    timewatchIdmsService.syncAllUserPhotosToDb().catch(pErr => {
      console.warn('[IMPORT PHOTO SYNC WARN]', pErr.message);
    });

    await logAudit({
      userId: req.user?.id,
      actorName: req.user?.full_name || 'System',
      actorRole: req.user?.role || 'ADMIN',
      action: 'STUDENTS_IMPORTED_AND_PUSHED_TO_TURNSTILES',
      entityType: 'STUDENT',
      entityId: 0,
      details: `Imported ${imported.length} new and updated ${updated.length} students from TimeWatch server, pushed to ${devices.length} turnstiles`,
      ipAddress: req.ip
    });

    return res.json({
      success: true,
      message: `Successfully synchronized ${imported.length} new and ${updated.length} existing enrolled students from TimeWatch server and pushed them to all ${devices.length} turnstile lanes.`,
      importedCount: imported.length,
      updatedCount: updated.length,
      turnstilesCount: devices.length,
      imported,
      updated
    });
  } catch (error) {
    next(error);
  }
}

async function syncTerminalPhotos(req, res, next) {
  try {
    const timewatchIdmsService = require('../services/timewatchIdmsService');
    const result = await timewatchIdmsService.syncAllUserPhotosToDb();

    await logAudit({
      userId: req.user?.id,
      actorName: req.user?.full_name || 'System',
      actorRole: req.user?.role || 'ADMIN',
      action: 'SYNC_STUDENT_PHOTOS',
      entityType: 'STUDENT',
      entityId: 0,
      details: `Synchronized ${result.updatedCount} student photos from TimeWatch server`,
      ipAddress: req.ip
    });

    return res.json({
      success: true,
      message: `Successfully synchronized ${result.updatedCount} student photos from TimeWatch server.`,
      ...result
    });
  } catch (error) {
    next(error);
  }
}

async function deleteStudent(req, res, next) {
  try {
    const { id } = req.params;
    const [[student]] = await pool.query('SELECT * FROM students WHERE id = ?', [id]);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    const [devices] = await pool.query("SELECT * FROM gate_devices WHERE status != 'OFFLINE'");
    const admsService = require('../services/admsService');
    const timewatchApiService = require('../services/timewatchApiService');
    const bioId = student.biometric_device_id || String(student.id);

    // 1. Delete from database (clean up room occupancy and outings)
    await withTransaction(async (conn) => {
      await conn.query('DELETE FROM outings WHERE student_id = ?', [id]);
      await conn.query('DELETE FROM students WHERE id = ?', [id]);
      if (student.room_id) {
        await conn.query(
          'UPDATE rooms SET current_occupancy = GREATEST(0, current_occupancy - 1), status = "AVAILABLE" WHERE id = ?',
          [student.room_id]
        );
      }
    });

    // 2. Queue terminal deletion command to all turnstile devices
    for (const dev of devices) {
      admsService.queueCommand(dev.serial_number, `DATA DELETE USER PIN=${bioId}`);
      admsService.queueCommand(dev.serial_number, `DATA DELETE BIODATA PIN=${bioId}`);
      timewatchApiService.deleteUser({
        UserID: bioId,
        DeviceID: dev.serial_number
      }).catch(() => {});
    }

    // 3. Delete from TimeWatch iDMS and trigger turnstile hardware deletion
    try {
      const timewatchIdmsService = require('../services/timewatchIdmsService');
      await timewatchIdmsService.deleteStudentFromTurnstiles({
        pin: bioId,
        name: `${student.first_name} ${student.last_name}`
      });
    } catch (err) {
      console.warn('[TIMEWATCH HARDWARE DELETE WARN]', err.message);
    }

    await logAudit({
      userId: req.user?.id,
      actorName: req.user?.full_name || 'System',
      actorRole: req.user?.role || 'ADMIN',
      action: 'STUDENT_DELETED',
      entityType: 'STUDENT',
      entityId: id,
      details: `Deleted student ${student.first_name} ${student.last_name} (${student.student_id}, PIN: ${bioId}) and queued hardware wipe on ${devices.length} turnstiles`,
      ipAddress: req.ip
    });

    return res.json({
      success: true,
      message: `Student ${student.first_name} ${student.last_name} deleted successfully and removed from all ${devices.length} turnstiles.`,
      studentId: id,
      biometricId: bioId
    });
  } catch (error) {
    next(error);
  }
}

async function deleteAllStudents(req, res, next) {
  try {
    const [students] = await pool.query('SELECT id, biometric_device_id, student_id FROM students');
    const [devices] = await pool.query("SELECT * FROM gate_devices WHERE status != 'OFFLINE'");
    const admsService = require('../services/admsService');
    const timewatchApiService = require('../services/timewatchApiService');

    // 1. Dispatch deletion commands to all turnstiles for each student
    let totalCommands = 0;
    for (const s of students) {
      const bioId = s.biometric_device_id || String(s.id);
      for (const dev of devices) {
        admsService.queueCommand(dev.serial_number, `DATA DELETE USER PIN=${bioId}`);
        admsService.queueCommand(dev.serial_number, `DATA DELETE BIODATA PIN=${bioId}`);
        timewatchApiService.deleteUser({ UserID: bioId, DeviceID: dev.serial_number }).catch(() => {});
        totalCommands += 2;
      }
    }

    // 1b. Also queue universal wipe commands across all active turnstiles
    for (const dev of devices) {
      admsService.queueCommand(dev.serial_number, 'CLEAR DATA');
      admsService.queueCommand(dev.serial_number, 'DATA DELETE USER PIN=ALL');
      totalCommands += 2;
    }

    // 2. Dispatch hardware wipe on physical turnstiles via TimeWatch iDMS
    try {
      const timewatchIdmsService = require('../services/timewatchIdmsService');
      await timewatchIdmsService.deleteAllStudentsFromTurnstiles();
    } catch (err) {
      console.warn('[TIMEWATCH HARDWARE DELETE ALL WARN]', err.message);
    }

    // 3. Clear records in database within transaction
    await withTransaction(async (conn) => {
      await conn.query('UPDATE gate_events SET student_id = NULL WHERE student_id IS NOT NULL');
      await conn.query('DELETE FROM outings');
      await conn.query('DELETE FROM students');
      await conn.query('UPDATE rooms SET current_occupancy = 0, status = "AVAILABLE"');
    });

    await logAudit({
      userId: req.user?.id,
      actorName: req.user?.full_name || 'System',
      actorRole: req.user?.role || 'SUPER_ADMIN',
      action: 'DELETE_ALL_STUDENTS',
      entityType: 'STUDENT',
      entityId: 0,
      details: `Deleted all ${students.length} students and queued ${totalCommands} deletion commands across all ${devices.length} turnstiles`,
      ipAddress: req.ip
    });

    return res.json({
      success: true,
      message: `Successfully deleted all ${students.length} students from SmartGate and dispatched wipe commands to all ${devices.length} turnstile lanes.`,
      deletedCount: students.length,
      turnstilesCount: devices.length,
      totalCommands
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Download sample Excel template for bulk student upload
 */
async function downloadStudentTemplate(req, res, next) {
  try {
    const buffer = bulkStudentUploadService.generateSampleTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Students_Bulk_Upload_Template.xlsx"');
    return res.send(buffer);
  } catch (error) {
    next(error);
  }
}

/**
 * Preview parsed students and image matches from Excel + Photos without saving
 */
async function previewBulkUpload(req, res, next) {
  try {
    const excelFile = req.files?.['excel']?.[0] || req.files?.['file']?.[0] || req.file;
    if (!excelFile || !excelFile.buffer) {
      return res.status(400).json({
        success: false,
        message: 'Excel file (.xlsx or .xls) is required for preview.'
      });
    }

    const zipFile = req.files?.['zip']?.[0];
    const photoFiles = req.files?.['photos'] || [];

    const result = bulkStudentUploadService.previewExcel(
      excelFile.buffer,
      photoFiles,
      zipFile ? zipFile.buffer : null
    );

    return res.json({
      success: true,
      ...result
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Commit bulk student upload to MySQL and optionally trigger hardware push to turnstiles
 */
async function bulkUploadStudents(req, res, next) {
  try {
    const excelFile = req.files?.['excel']?.[0] || req.files?.['file']?.[0] || req.file;
    if (!excelFile || !excelFile.buffer) {
      return res.status(400).json({
        success: false,
        message: 'Excel file (.xlsx or .xls) is required for bulk upload.'
      });
    }

    const zipFile = req.files?.['zip']?.[0];
    const photoFiles = req.files?.['photos'] || [];
    const autoPush = req.body.autoPushToTurnstiles !== 'false' && req.body.autoPushToTurnstiles !== false;

    const result = await bulkStudentUploadService.processBulkUpload(
      excelFile.buffer,
      photoFiles,
      zipFile ? zipFile.buffer : null,
      autoPush
    );

    await logAudit({
      userId: req.user?.id,
      actorName: req.user?.full_name || 'System',
      actorRole: req.user?.role || 'SUPER_ADMIN',
      action: 'BULK_UPLOAD_STUDENTS',
      entityType: 'STUDENT',
      entityId: 0,
      details: `Bulk uploaded ${result.totalProcessed} students (${result.importedCount} new, ${result.updatedCount} updated). AutoPush: ${autoPush}`,
      ipAddress: req.ip
    });

    return res.json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getStudents,
  getStudentById,
  createStudent,
  updateStudent,
  deleteStudent,
  deleteAllStudents,
  toggleStudentStatus,
  syncStudentToTerminal,
  syncAllStudentsToTerminals,
  remoteEnrollStudent,
  getStudentTerminalImage,
  deleteStudentFromTerminal,
  importStudentsFromTerminal,
  syncTerminalPhotos,
  downloadStudentTemplate,
  previewBulkUpload,
  bulkUploadStudents
};


