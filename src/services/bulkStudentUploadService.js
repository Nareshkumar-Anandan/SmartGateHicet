const xlsx = require('xlsx');
const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { pool, withTransaction } = require('../config/database');
const timewatchIdmsService = require('./timewatchIdmsService');
const admsService = require('./admsService');
const timewatchApiService = require('./timewatchApiService');

const UPLOADS_DIR = path.resolve(__dirname, '../../uploads/students');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

class BulkStudentUploadService {
  /**
   * Normalize header string for resilient column matching
   */
  _normalizeHeader(str) {
    if (!str) return '';
    return String(str)
      .toLowerCase()
      .replace(/[\s\.\(\)\-_'\’\/]/g, '');
  }

  /**
   * Format date values into clean YYYY-MM-DD format
   */
  _formatDate(val) {
    if (!val) return '';
    if (val instanceof Date && !isNaN(val.getTime())) {
      const y = val.getFullYear();
      const m = String(val.getMonth() + 1).padStart(2, '0');
      const d = String(val.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    const str = String(val).trim();
    if (str) {
      const dObj = new Date(str);
      if (!isNaN(dObj.getTime()) && (str.includes('GMT') || str.includes('T') || str.length > 10)) {
        const y = dObj.getFullYear();
        const m = String(dObj.getMonth() + 1).padStart(2, '0');
        const d = String(dObj.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
    }
    return str.slice(0, 100);
  }

  /**
   * Find field value in row object across variations of column names
   */
  _getValue(row, aliases, isDate = false) {
    const rowKeys = Object.keys(row);
    for (const alias of aliases) {
      const normAlias = this._normalizeHeader(alias);
      for (const key of rowKeys) {
        if (this._normalizeHeader(key) === normAlias) {
          const val = row[key];
          if (isDate) {
            return this._formatDate(val);
          }
          return val !== undefined && val !== null ? String(val).trim() : '';
        }
      }
    }
    return '';
  }

  /**
   * Optimize student photograph: auto-orient, max 480x640 portrait, JPEG 85% (~40-70 KB)
   * Prevents TimeWatch iDMS request limit errors and ensures hardware memory compatibility
   */
  async _optimizePhoto(buffer) {
    if (!buffer || !Buffer.isBuffer(buffer)) return buffer;
    try {
      return await sharp(buffer)
        .rotate()
        .resize(480, 640, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85, progressive: false })
        .toBuffer();
    } catch (err) {
      console.warn('[BULK UPLOAD] Photo optimization fallback:', err.message);
      return buffer;
    }
  }

  /**
   * Process and index uploaded images (from files array and/or zip archive)
   * Keyed by normalized register number (e.g. "720721104001")
   */
  _buildImageMap(files = [], zipBuffer = null) {
    const imageMap = new Map(); // regNo -> { filename, buffer, ext }

    // 1. Process individual image files
    for (const file of files) {
      if (!file || !file.originalname || !file.buffer) continue;
      const baseName = path.parse(file.originalname).name.trim();
      const ext = path.parse(file.originalname).ext.toLowerCase() || '.jpg';
      const cleanReg = baseName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      if (cleanReg) {
        imageMap.set(cleanReg, {
          filename: file.originalname,
          buffer: file.buffer,
          ext: ext === '.jpeg' ? '.jpg' : ext
        });
      }
    }

    // 2. Process zip archive if provided
    if (zipBuffer && Buffer.isBuffer(zipBuffer)) {
      try {
        const zip = new AdmZip(zipBuffer);
        const zipEntries = zip.getEntries();
        for (const entry of zipEntries) {
          if (entry.isDirectory) continue;
          const ext = path.extname(entry.entryName).toLowerCase();
          if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
            const baseName = path.parse(path.basename(entry.entryName)).name.trim();
            const cleanReg = baseName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            if (cleanReg) {
              imageMap.set(cleanReg, {
                filename: path.basename(entry.entryName),
                buffer: entry.getData(),
                ext: ext === '.jpeg' ? '.jpg' : ext
              });
            }
          }
        }
      } catch (err) {
        console.warn('[BULK UPLOAD] Failed to unpack photos zip:', err.message);
      }
    }

    return imageMap;
  }

  /**
   * Parse uploaded Excel/CSV file and preview records without saving
   */
  previewExcel(fileBuffer, imageFiles = [], zipBuffer = null) {
    const workbook = xlsx.read(fileBuffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawRows = xlsx.utils.sheet_to_json(sheet, { defval: '' });

    const imageMap = this._buildImageMap(imageFiles, zipBuffer);
    const parsedStudents = [];

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const regNo = this._getValue(row, ['Register Number', 'Registration Number', 'Reg No', 'Register No', 'Student ID', 'Roll No']);
      const studentName = this._getValue(row, ['Students Name', 'Student Name', 'Name', 'FullName']);

      if (!regNo && !studentName) continue; // Skip blank rows

      const cleanReg = regNo.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      const matchedPhoto = cleanReg ? imageMap.get(cleanReg) : null;

      // Extract details
      const institution = this._getValue(row, ['Institution', 'College']);
      const year = parseInt(this._getValue(row, ['Year', 'Year of Study']) || '1', 10) || 1;
      const department = this._getValue(row, ['Department', 'Dept', 'Branch']) || 'Engineering';
      const hostelName = this._getValue(row, ['Hostel Name', 'Hostel', 'Hostel Block']);
      const floor = this._getValue(row, ['Floor']);
      const roomNo = this._getValue(row, ['Room No', 'Room Number', 'Room']);
      const guardianName = this._getValue(row, ["Guardian's Name", 'Guardian Name', 'Parent Name', 'Father Name']);
      const dob = this._getValue(row, ['Date of Birth', 'DOB', 'Birth Date', 'Date of birth'], true);
      const gender = this._getValue(row, ['Gender', 'Sex']);
      const district = this._getValue(row, ['Location (District)', 'Location', 'District', 'City']);
      const address = this._getValue(row, ['Permanent Address', 'Address']);
      const pincode = this._getValue(row, ['PIN Code', 'Pincode', 'Postal Code', 'Pin']);
      const email = this._getValue(row, ['Email', 'Email ID', 'Mail']) || (cleanReg ? `stu_${cleanReg.toLowerCase()}@hicet.ac.in` : '');
      const phone = this._getValue(row, ['Mobile No.', 'Mobile', 'Phone', 'Student Mobile', 'Student Phone']);
      const aadhar = this._getValue(row, ['Aadhar', 'Aadhar No', 'Aadhar Number']);
      const guardianPhone = this._getValue(row, ['Guardian No.', 'Guardian Phone', 'Parent Mobile', 'Parent Phone']);
      const photoColumnVal = this._getValue(row, ['Clear photo of your Face(Recently captured)', 'Photo', 'Image', 'Face Photo']);

      parsedStudents.push({
        rowNumber: i + 2, // 1-indexed Excel row (header is 1)
        studentName,
        regNo: cleanReg || `STU-${i + 1}`,
        institution: institution || 'Hindusthan Institute of Technology (HICET)',
        year,
        department,
        hostelName: hostelName || 'Kaveri Boys Hostel (Block A)',
        floor: floor || '1',
        roomNo: roomNo || '101',
        guardianName,
        dob,
        gender: gender ? gender.toUpperCase() : 'MALE',
        district,
        address,
        pincode,
        email,
        phone: phone || '9876543210',
        aadhar,
        guardianPhone: guardianPhone || phone || '9876543210',
        photoColumnVal,
        hasMatchedPhoto: !!matchedPhoto,
        matchedPhotoName: matchedPhoto ? matchedPhoto.filename : (photoColumnVal || null)
      });
    }

    return {
      totalRows: parsedStudents.length,
      matchedPhotosCount: parsedStudents.filter(s => s.hasMatchedPhoto).length,
      students: parsedStudents
    };
  }

  /**
   * Import students from Excel and matched images into MySQL and push to turnstiles
   */
  async processBulkUpload(fileBuffer, imageFiles = [], zipBuffer = null, autoPushToTurnstiles = true) {
    const preview = this.previewExcel(fileBuffer, imageFiles, zipBuffer);
    const imageMap = this._buildImageMap(imageFiles, zipBuffer);

    if (preview.students.length === 0) {
      throw new Error('No valid student rows found in the uploaded Excel/CSV file.');
    }

    // 1. Fetch available hostels and rooms
    const [hostels] = await pool.query('SELECT id, name, code FROM hostels');
    const hostelMap = new Map();
    hostels.forEach(h => {
      hostelMap.set(h.name.toLowerCase(), h.id);
      hostelMap.set(h.code.toLowerCase(), h.id);
    });
    const defaultHostelId = hostels[0]?.id || 1;

    // Fetch rooms
    const [rooms] = await pool.query('SELECT id, hostel_id, room_number, floor, capacity, current_occupancy FROM rooms');
    const roomMap = new Map(); // "hostelId:roomNo" -> room
    rooms.forEach(r => roomMap.set(`${r.hostel_id}:${String(r.room_number).trim()}`, r));

    // Get current max biometric numeric PIN
    const [[maxRow]] = await pool.query(
      "SELECT MAX(CAST(biometric_device_id AS UNSIGNED)) as maxPin FROM students WHERE biometric_device_id REGEXP '^[0-9]+$'"
    );
    let nextNumericPin = Math.max((maxRow?.maxPin || 7), 7) + 1;

    const imported = [];
    const updated = [];
    const errors = [];

    for (const student of preview.students) {
      try {
        const cleanReg = student.regNo;
        const nameParts = student.studentName.trim().split(' ');
        const firstName = nameParts[0] || student.studentName;
        const lastName = nameParts.slice(1).join(' ') || '.';

        // 2. Resolve photo
        let photoAvatar = null;
        let photoUrl = null;
        const matchedPhoto = imageMap.get(cleanReg);

        if (matchedPhoto) {
          const saveFilename = `${cleanReg}.jpg`;
          const savePath = path.join(UPLOADS_DIR, saveFilename);
          const optimizedBuffer = await this._optimizePhoto(matchedPhoto.buffer);
          fs.writeFileSync(savePath, optimizedBuffer);
          photoAvatar = `/uploads/students/${saveFilename}`;
          photoUrl = `/uploads/students/${saveFilename}`;
        } else {
          // Check if photo file already exists on disk for this registration number
          const existingCandidate = [
            `${cleanReg}.jpg`,
            `${cleanReg}.jpeg`,
            `${cleanReg}.png`
          ].find(f => fs.existsSync(path.join(UPLOADS_DIR, f)));
          if (existingCandidate) {
            photoAvatar = `/uploads/students/${existingCandidate}`;
            photoUrl = `/uploads/students/${existingCandidate}`;
          }
        }

        // 3. Resolve Hostel
        let targetHostelId = defaultHostelId;
        if (student.hostelName) {
          const hKey = student.hostelName.toLowerCase();
          for (const [k, hid] of hostelMap.entries()) {
            if (hKey.includes(k) || k.includes(hKey)) {
              targetHostelId = hid;
              break;
            }
          }
        }

        // 4. Resolve Room with ON DUPLICATE KEY protection
        let targetRoomId = null;
        if (student.roomNo && String(student.roomNo).trim()) {
          const roomClean = String(student.roomNo).trim();
          const roomKey = `${targetHostelId}:${roomClean}`;
          let room = roomMap.get(roomKey);
          if (!room) {
            const [existingRooms] = await pool.query(
              'SELECT id FROM rooms WHERE hostel_id = ? AND room_number = ?',
              [targetHostelId, roomClean]
            );
            if (existingRooms.length > 0) {
              targetRoomId = existingRooms[0].id;
              roomMap.set(roomKey, { id: targetRoomId, hostel_id: targetHostelId, room_number: roomClean });
            } else {
              try {
                const [newRoomRes] = await pool.query(
                  `INSERT INTO rooms (hostel_id, room_number, floor, capacity, current_occupancy, status)
                   VALUES (?, ?, ?, 4, 1, 'AVAILABLE')
                   ON DUPLICATE KEY UPDATE current_occupancy = LEAST(capacity, current_occupancy + 1)`,
                  [targetHostelId, roomClean, parseInt(student.floor || '1', 10) || 1]
                );
                targetRoomId = newRoomRes.insertId;
                if (!targetRoomId) {
                  const [[rRow]] = await pool.query('SELECT id FROM rooms WHERE hostel_id = ? AND room_number = ?', [targetHostelId, roomClean]);
                  targetRoomId = rRow?.id || null;
                }
                roomMap.set(roomKey, { id: targetRoomId, hostel_id: targetHostelId, room_number: roomClean });
              } catch (rErr) {
                console.warn('[BULK UPLOAD] Room auto-assign fallback:', rErr.message);
              }
            }
          } else {
            targetRoomId = room.id;
            await pool.query('UPDATE rooms SET current_occupancy = LEAST(capacity, current_occupancy + 1) WHERE id = ?', [targetRoomId]);
          }
        }

        // 5. Determine numeric PIN for biometric terminal with collision checking
        let assignedPin = String(nextNumericPin++);
        while (true) {
          const [[pinRow]] = await pool.query('SELECT id FROM students WHERE biometric_device_id = ?', [assignedPin]);
          if (!pinRow) break;
          assignedPin = String(nextNumericPin++);
        }

        // 6. Safe field sizing
        const safePhone = (student.phone || '9876543210').slice(0, 20);
        const safeGuardianPhone = (student.guardianPhone || safePhone).slice(0, 20);
        const safeGender = (student.gender || 'MALE').slice(0, 20);
        const safeAadhar = (student.aadhar || '').slice(0, 30);
        const safePincode = (student.pincode || '').slice(0, 20);
        const safeEmail = (student.email || `stu_${cleanReg.toLowerCase()}@hicet.ac.in`).slice(0, 255);
        const safeDept = (student.department || 'Engineering').slice(0, 100);
        const safeDob = this._formatDate(student.dob) || null;

        // 7. Check if student already exists
        const [existing] = await pool.query(
          'SELECT id, student_id, biometric_device_id, photo_avatar FROM students WHERE student_id = ? OR email = ?',
          [cleanReg, safeEmail]
        );

        if (existing.length === 0) {
          // Insert new student
          const [insRes] = await pool.query(
            `INSERT INTO students 
             (student_id, first_name, last_name, department, course, year_of_study, phone, parent_phone, email, 
              hostel_id, room_id, current_location_status, biometric_device_id, biometric_enrolled, 
              photo_avatar, is_active, institution, gender, dob, guardian_name, district, address, pincode, aadhar_number, photo_url)
             VALUES (?, ?, ?, ?, 'B.E.', ?, ?, ?, ?, ?, ?, 'INSIDE', ?, 1, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              cleanReg,
              firstName || 'Student',
              lastName || cleanReg,
              safeDept,
              student.year || 1,
              safePhone,
              safeGuardianPhone,
              safeEmail,
              targetHostelId,
              targetRoomId,
              assignedPin,
              photoAvatar,
              student.institution || 'Hindusthan Institute of Technology (HICET)',
              safeGender,
              safeDob,
              student.guardianName || null,
              student.district || null,
              student.address || null,
              safePincode,
              safeAadhar,
              photoUrl
            ]
          );

          imported.push({
            id: insRes.insertId,
            studentId: cleanReg,
            name: `${firstName} ${lastName}`,
            pin: assignedPin,
            hasPhoto: !!photoAvatar
          });
        } else {
          // Update existing student
          const s = existing[0];
          assignedPin = s.biometric_device_id || assignedPin;

          await pool.query(
            `UPDATE students 
             SET first_name = ?, last_name = ?, department = ?, year_of_study = ?, phone = ?, parent_phone = ?,
                 hostel_id = COALESCE(?, hostel_id), room_id = COALESCE(?, room_id),
                 photo_avatar = COALESCE(?, photo_avatar), photo_url = COALESCE(?, photo_url),
                 institution = COALESCE(?, institution), gender = COALESCE(?, gender),
                 dob = COALESCE(?, dob), guardian_name = COALESCE(?, guardian_name),
                 district = COALESCE(?, district), address = COALESCE(?, address),
                 pincode = COALESCE(?, pincode), aadhar_number = COALESCE(?, aadhar_number),
                 updated_at = NOW()
             WHERE id = ?`,
            [
              firstName || s.first_name,
              lastName || s.last_name,
              safeDept,
              student.year || s.year_of_study,
              safePhone,
              safeGuardianPhone,
              targetHostelId,
              targetRoomId,
              photoAvatar,
              photoUrl,
              student.institution || s.institution,
              safeGender,
              safeDob || s.dob,
              student.guardianName || s.guardian_name,
              student.district || s.district,
              student.address || s.address,
              safePincode,
              safeAadhar,
              s.id
            ]
          );

          updated.push({
            id: s.id,
            studentId: cleanReg,
            name: `${firstName} ${lastName}`,
            pin: assignedPin,
            hasPhoto: !!photoAvatar || !!s.photo_avatar
          });
        }
      } catch (err) {
        console.error(`[BULK UPLOAD ERROR] Row ${student.rowNumber} (${student.regNo}):`, err.message);
        errors.push({ rowNumber: student.rowNumber, regNo: student.regNo, error: err.message });
      }
    }

    // 7. Auto-push to physical turnstiles if requested
    let hardwarePushResult = null;
    if (autoPushToTurnstiles && (imported.length > 0 || updated.length > 0)) {
      try {
        console.log('[BULK UPLOAD] Automatically dispatching hardware sync to all 8 turnstile machines...');
        hardwarePushResult = await timewatchIdmsService.pushAllStudentsToTurnstiles();

      } catch (err) {
        console.warn('[BULK UPLOAD HARDWARE PUSH WARN]', err.message);
        hardwarePushResult = { success: false, error: err.message };
      }
    }

    return {
      success: true,
      message: `Successfully processed ${imported.length + updated.length} students (${imported.length} new registered, ${updated.length} updated).`,
      totalProcessed: imported.length + updated.length,
      importedCount: imported.length,
      updatedCount: updated.length,
      errorCount: errors.length,
      imported,
      updated,
      errors,
      hardwarePushResult
    };
  }

  /**
   * Generate downloadable sample Excel template matching user's exact specification
   */
  generateSampleTemplate() {
    const headers = [
      'SI No',
      'Students Name',
      'Institution',
      'Year',
      'Register Number',
      'Department',
      'Hostel Name',
      'Floor',
      'Room No',
      "Guardian's Name",
      'Date of Birth',
      'Gender',
      'Location (District)',
      'Permanent Address',
      'PIN Code',
      'Email',
      'Mobile No.',
      'Aadhar',
      'Guardian No.',
      'Clear photo of your Face(Recently captured)'
    ];

    const sampleRows = [
      {
        'SI No': 1,
        'Students Name': 'Aravind Swaminathan',
        'Institution': 'Hindusthan Institute of Technology (HICET)',
        'Year': 2,
        'Register Number': '720721104001',
        'Department': 'Computer Science & Engineering',
        'Hostel Name': 'Kaveri Boys Hostel (Block A)',
        'Floor': 1,
        'Room No': '101',
        "Guardian's Name": 'Swaminathan K',
        'Date of Birth': '2004-05-15',
        'Gender': 'Male',
        'Location (District)': 'Coimbatore',
        'Permanent Address': '12/4 Gandhipuram, Coimbatore',
        'PIN Code': '641012',
        'Email': 'aravind.720721104001@hicet.ac.in',
        'Mobile No.': '9876543211',
        'Aadhar': '123456789012',
        'Guardian No.': '9876543200',
        'Clear photo of your Face(Recently captured)': '720721104001.jpg'
      },
      {
        'SI No': 2,
        'Students Name': 'Priyanka Ramesh',
        'Institution': 'Hindusthan Institute of Technology (HICET)',
        'Year': 3,
        'Register Number': '720721104002',
        'Department': 'Information Technology',
        'Hostel Name': 'Bhavani Girls Hostel (Block B)',
        'Floor': 2,
        'Room No': '205',
        "Guardian's Name": 'Ramesh M',
        'Date of Birth': '2003-11-20',
        'Gender': 'Female',
        'Location (District)': 'Tirupur',
        'Permanent Address': '45 Avinashi Road, Tirupur',
        'PIN Code': '641602',
        'Email': 'priyanka.720721104002@hicet.ac.in',
        'Mobile No.': '9876543222',
        'Aadhar': '234567890123',
        'Guardian No.': '9876543201',
        'Clear photo of your Face(Recently captured)': '720721104002.jpg'
      }
    ];

    const worksheet = xlsx.utils.json_to_sheet(sampleRows, { header: headers });

    // Set column widths
    worksheet['!cols'] = [
      { wch: 8 },  // SI No
      { wch: 22 }, // Students Name
      { wch: 38 }, // Institution
      { wch: 8 },  // Year
      { wch: 18 }, // Register Number
      { wch: 28 }, // Department
      { wch: 28 }, // Hostel Name
      { wch: 8 },  // Floor
      { wch: 10 }, // Room No
      { wch: 20 }, // Guardian's Name
      { wch: 14 }, // Date of Birth
      { wch: 10 }, // Gender
      { wch: 20 }, // Location
      { wch: 35 }, // Permanent Address
      { wch: 12 }, // PIN Code
      { wch: 32 }, // Email
      { wch: 14 }, // Mobile No.
      { wch: 16 }, // Aadhar
      { wch: 14 }, // Guardian No.
      { wch: 30 }  // Photo
    ];

    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Students Data');

    return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }
}

module.exports = new BulkStudentUploadService();
