const express = require('express');
const router = express.Router();
const timewatchController = require('../controllers/timewatch.controller');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

// All endpoints require authentication
router.use(authenticateToken);

// Configuration & Connectivity
router.get('/config', timewatchController.getConfig);
router.post('/config', requireRole('SUPER_ADMIN'), timewatchController.updateConfig);
router.post('/test-connection', timewatchController.testConnection);

// Terminal Device Management (TWAPI)
router.post('/devices', timewatchController.getDeviceList);
router.post('/sync-time', requireRole('SUPER_ADMIN'), timewatchController.syncTime);
router.post('/pull-logs', requireRole('SUPER_ADMIN'), timewatchController.pullLogs);
router.post('/commands', timewatchController.getCommands);

// Punch Records & Ingestion
router.post('/punches/fetch', timewatchController.getPunchData);
router.post('/punches/sync', requireRole('SUPER_ADMIN', 'WARDEN'), timewatchController.syncPunches);

// Biometric User & Enrollment Operations
router.post('/users/details', timewatchController.getUserDetail);
router.post('/users/add', requireRole('SUPER_ADMIN', 'WARDEN'), timewatchController.addUser);
router.post('/users/delete', requireRole('SUPER_ADMIN', 'WARDEN'), timewatchController.deleteUser);
router.post('/users/image', timewatchController.getUserImage);
router.post('/remote-enroll', requireRole('SUPER_ADMIN', 'WARDEN'), timewatchController.remoteEnrollment);

// TimeWatch iDMS Server Endpoints (172.25.3.51:9001)
router.get('/server-status', timewatchController.getServerStatus);
router.post('/sync-devices', requireRole('SUPER_ADMIN', 'WARDEN'), timewatchController.syncIdmsDevices);
router.post('/sync-users', requireRole('SUPER_ADMIN', 'WARDEN'), timewatchController.syncIdmsUsers);
router.post('/sync-punches', requireRole('SUPER_ADMIN', 'WARDEN'), timewatchController.syncIdmsPunches);
router.post('/toggle-live-sync', requireRole('SUPER_ADMIN'), timewatchController.toggleLiveSync);
router.get('/live-logs', timewatchController.getIdmsPunches);

module.exports = router;
