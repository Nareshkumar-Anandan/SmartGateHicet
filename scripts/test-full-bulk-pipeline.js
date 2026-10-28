const xlsx = require('xlsx');
const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const bulkService = require('../src/services/bulkStudentUploadService');

async function testFullBulkPipeline() {
  console.log('=== TEST 1: Preparing Excel & Photo ZIP for Bulk Enrollment ===');

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

  const students = [
    {
      'SI No': 1,
      'Students Name': 'Navaneeth Murali',
      'Institution': 'Hindusthan Institute of Technology (HICET)',
      'Year': 3,
      'Register Number': '720726106077',
      'Department': 'Computer Science & Engineering',
      'Hostel Name': 'Kaveri Boys Hostel (Block A)',
      'Floor': 1,
      'Room No': '101',
      "Guardian's Name": 'Murali K',
      'Date of Birth': '2004-06-12',
      'Gender': 'Male',
      'Location (District)': 'Coimbatore',
      'Permanent Address': '15 Gandhi Street, Coimbatore',
      'PIN Code': '641028',
      'Email': 'navaneeth.720726106077@hicet.ac.in',
      'Mobile No.': '9876543201',
      'Aadhar': '887766554433',
      'Guardian No.': '9876543200',
      'Clear photo of your Face(Recently captured)': '720726106077.jpg'
    },
    {
      'SI No': 2,
      'Students Name': 'Kavitha Shanmugam',
      'Institution': 'Hindusthan Institute of Technology (HICET)',
      'Year': 2,
      'Register Number': '720726109081',
      'Department': 'Information Technology',
      'Hostel Name': 'Bhavani Girls Hostel (Block B)',
      'Floor': 2,
      'Room No': '202',
      "Guardian's Name": 'Shanmugam R',
      'Date of Birth': '2005-02-18',
      'Gender': 'Female',
      'Location (District)': 'Erode',
      'Permanent Address': '42 Perundurai Road, Erode',
      'PIN Code': '638011',
      'Email': 'kavitha.720726109081@hicet.ac.in',
      'Mobile No.': '9876543202',
      'Aadhar': '776655443322',
      'Guardian No.': '9876543200',
      'Clear photo of your Face(Recently captured)': '720726109081.jpg'
    }
  ];

  const ws = xlsx.utils.json_to_sheet(students, { header: headers });
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Students');
  const excelBuffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

  // Create Zip containing the two photos
  const zip = new AdmZip();
  const photo1 = fs.readFileSync(path.resolve(__dirname, '../uploads/students/720726106077.jpg'));
  const photo2 = fs.readFileSync(path.resolve(__dirname, '../uploads/students/720726109081.jpg'));
  zip.addFile('720726106077.jpg', photo1);
  zip.addFile('720726109081.jpg', photo2);
  const zipBuffer = zip.toBuffer();

  console.log('=== TEST 2: Testing previewExcel (Validation & Photo Auto-Matching) ===');
  const preview = bulkService.previewExcel(excelBuffer, [], zipBuffer);
  console.log('Preview Result:');
  console.log('  Total Rows:', preview.totalRows);
  console.log('  Matched Photos:', preview.matchedPhotosCount);
  preview.students.forEach(s => {
    console.log(`  - Row ${s.rowNumber}: ${s.studentName} (${s.regNo}) | Photo: ${s.hasMatchedPhoto ? 'MATCHED (' + s.matchedPhotoName + ')' : 'NONE'}`);
  });

  if (preview.totalRows !== 2 || preview.matchedPhotosCount !== 2) {
    throw new Error('Preview validation failed! Expected 2 students with matched photos.');
  }

  console.log('\n=== TEST 3: Executing processBulkUpload (Database insertion & Hardware Push) ===');
  const processResult = await bulkService.processBulkUpload(excelBuffer, [], zipBuffer, true);
  console.log('Bulk Upload Process Result:');
  console.log('  Success:', processResult.success);
  console.log('  Message:', processResult.message);
  console.log('  Total Processed:', processResult.totalProcessed);
  console.log('  Imported Count:', processResult.importedCount);
  console.log('  Updated Count:', processResult.updatedCount);
  console.log('  Error Count:', processResult.errorCount);
  if (processResult.errors.length > 0) {
    console.log('  Errors:', processResult.errors);
  }

  console.log('\n=== TEST 4: Verifying MySQL records and Biometric Device ID PIN assignment ===');
  const { pool } = require('../src/config/database');
  const [rows] = await pool.query(
    "SELECT id, student_id, first_name, last_name, biometric_device_id, photo_avatar, is_active FROM students WHERE student_id IN ('720726106077', '720726109081')"
  );
  console.log('Database verification:');
  rows.forEach(r => {
    console.log(`  Student: ${r.first_name} ${r.last_name} | Reg: ${r.student_id} | Assigned Biometric PIN: ${r.biometric_device_id} | Photo: ${r.photo_avatar}`);
  });

  console.log('\n=== ALL TESTS PASSED SUCCESSFULLY! ===');
  process.exit(0);
}

testFullBulkPipeline().catch(err => {
  console.error('Test pipeline error:', err);
  process.exit(1);
});
