const express = require('express');
const router = express.Router();
const auditController = require('../controllers/audit.controller');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

// Super Admin only
router.get('/', authenticateToken, requireRole('SUPER_ADMIN'), auditController.getAuditLogs);

module.exports = router;
