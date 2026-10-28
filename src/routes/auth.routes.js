const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticateToken } = require('../middleware/auth');

router.post('/login', authController.login);
router.post('/change-password', authenticateToken, authController.changePassword);
router.get('/me', authenticateToken, authController.getProfile);
router.post('/logout', authenticateToken, authController.logout);

module.exports = router;
