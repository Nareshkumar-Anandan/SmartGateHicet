const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboard.controller');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

router.get('/admin', authenticateToken, requireRole('SUPER_ADMIN'), dashboardController.getAdminSummary);
router.get('/warden', authenticateToken, requireRole('SUPER_ADMIN', 'WARDEN'), dashboardController.getWardenSummary);

module.exports = router;
