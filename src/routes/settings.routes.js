const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settings.controller');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

router.get('/', authenticateToken, settingsController.getSettings);
router.put('/', authenticateToken, requireRole('SUPER_ADMIN'), settingsController.updateSettings);
router.post('/emergency-override', authenticateToken, requireRole('SUPER_ADMIN'), settingsController.triggerEmergencyOverride);

module.exports = router;
