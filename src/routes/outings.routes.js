const express = require('express');
const router = express.Router();
const outingsController = require('../controllers/outings.controller');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

router.get('/', authenticateToken, outingsController.getOutings);
router.get('/overdue', authenticateToken, outingsController.getOverdueOutings);
router.post('/', authenticateToken, requireRole('SUPER_ADMIN', 'WARDEN'), outingsController.createOuting);
router.patch('/:id/approve', authenticateToken, requireRole('SUPER_ADMIN', 'WARDEN'), outingsController.approveOuting);
router.patch('/:id/reject', authenticateToken, requireRole('SUPER_ADMIN', 'WARDEN'), outingsController.rejectOuting);
router.patch('/:id/manual-return', authenticateToken, requireRole('SUPER_ADMIN', 'WARDEN'), outingsController.confirmManualReturn);

module.exports = router;
