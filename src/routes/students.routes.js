const express = require('express');
const router = express.Router();
const multer = require('multer');
const studentsController = require('../controllers/students.controller');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

const bulkFields = upload.fields([
  { name: 'excel', maxCount: 1 },
  { name: 'file', maxCount: 1 },
  { name: 'zip', maxCount: 1 },
  { name: 'photos', maxCount: 500 }
]);

// Bulk Excel & Face Photo Upload & Template
router.get('/template', authenticateToken, studentsController.downloadStudentTemplate);
router.post('/bulk-preview', authenticateToken, requireRole('SUPER_ADMIN', 'WARDEN'), bulkFields, studentsController.previewBulkUpload);
router.post('/bulk-upload', authenticateToken, requireRole('SUPER_ADMIN', 'WARDEN'), bulkFields, studentsController.bulkUploadStudents);

router.get('/', authenticateToken, studentsController.getStudents);
router.get('/:id', authenticateToken, studentsController.getStudentById);
router.post('/', authenticateToken, requireRole('SUPER_ADMIN', 'WARDEN'), studentsController.createStudent);
router.put('/:id', authenticateToken, requireRole('SUPER_ADMIN', 'WARDEN'), studentsController.updateStudent);
router.patch('/:id/status', authenticateToken, requireRole('SUPER_ADMIN', 'WARDEN'), studentsController.toggleStudentStatus);

// TimeWatch Terminal Hardware Integration for Students
router.post('/import-from-terminal', authenticateToken, requireRole('SUPER_ADMIN', 'WARDEN'), studentsController.importStudentsFromTerminal);
router.post('/sync-terminal-photos', authenticateToken, requireRole('SUPER_ADMIN', 'WARDEN'), studentsController.syncTerminalPhotos);
router.post('/sync-all-to-terminals', authenticateToken, requireRole('SUPER_ADMIN', 'WARDEN'), studentsController.syncAllStudentsToTerminals);
router.post('/:id/timewatch-sync', authenticateToken, requireRole('SUPER_ADMIN', 'WARDEN'), studentsController.syncStudentToTerminal);
router.post('/:id/timewatch-remote-enroll', authenticateToken, requireRole('SUPER_ADMIN', 'WARDEN'), studentsController.remoteEnrollStudent);
router.get('/:id/timewatch-image', authenticateToken, studentsController.getStudentTerminalImage);
router.post('/:id/timewatch-delete', authenticateToken, requireRole('SUPER_ADMIN', 'WARDEN'), studentsController.deleteStudentFromTerminal);

// Student Deletion (SmartGate Database + Turnstiles)
router.delete('/all', authenticateToken, requireRole('SUPER_ADMIN'), studentsController.deleteAllStudents);
router.delete('/:id', authenticateToken, requireRole('SUPER_ADMIN', 'WARDEN'), studentsController.deleteStudent);

module.exports = router;


