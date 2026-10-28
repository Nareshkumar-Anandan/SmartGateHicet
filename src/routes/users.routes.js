const express = require('express');
const router = express.Router();
const usersController = require('../controllers/users.controller');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

router.get('/', authenticateToken, requireRole('SUPER_ADMIN'), usersController.getUsers);
router.post('/', authenticateToken, requireRole('SUPER_ADMIN'), usersController.createUser);
router.post('/:id/reset-password', authenticateToken, requireRole('SUPER_ADMIN'), usersController.resetUserPassword);
router.patch('/:id/status', authenticateToken, requireRole('SUPER_ADMIN'), usersController.toggleUserStatus);

module.exports = router;
