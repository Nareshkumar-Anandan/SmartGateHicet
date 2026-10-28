const bulkService = require('../src/services/bulkStudentUploadService');
const fs = require('fs');
const path = require('path');

async function test() {
  console.log('Testing processBulkUpload with photo sync...');
  const excelBuffer = bulkService.generateSampleTemplate();
  const img1Path = path.join(__dirname, '../uploads/students/720726106077.jpg');
  const img2Path = path.join(__dirname, '../uploads/students/720726109081.jpg');
  const images = [
    { originalname: '720726106077.jpg', buffer: fs.readFileSync(img1Path) },
    { originalname: '720726109081.jpg', buffer: fs.readFileSync(img2Path) }
  ];

  const result = await bulkService.processBulkUpload(excelBuffer, images, null, true);
  console.log('Result:\n', JSON.stringify({
    success: result.success,
    totalProcessed: result.totalProcessed,
    importedCount: result.importedCount,
    updatedCount: result.updatedCount,
    errorCount: result.errorCount,
    imported: result.imported,
    updated: result.updated,
    hardwarePushResult: result.hardwarePushResult
  }, null, 2));
}

test().catch(console.error).finally(() => process.exit(0));
