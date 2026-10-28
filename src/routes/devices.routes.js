const express = require('express');
const router = express.Router();
const devicesController = require('../controllers/devices.controller');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

router.get('/', authenticateToken, devicesController.getDevices);
router.get('/:id', authenticateToken, devicesController.getDeviceById);
router.put('/:id', authenticateToken, requireRole('SUPER_ADMIN'), devicesController.updateDevice);
router.post('/:id/test-relay', authenticateToken, requireRole('SUPER_ADMIN'), devicesController.testRelayPulse);
router.post('/:id/ping', authenticateToken, devicesController.pingDevice);

module.exports = router;
