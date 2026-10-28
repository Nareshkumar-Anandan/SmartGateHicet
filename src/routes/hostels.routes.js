const express = require('express');
const router = express.Router();
const hostelsController = require('../controllers/hostels.controller');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

router.get('/', authenticateToken, hostelsController.getHostels);
router.get('/rooms', authenticateToken, hostelsController.getRooms);
router.get('/wardens', authenticateToken, hostelsController.getWardens);
router.get('/:id', authenticateToken, hostelsController.getHostelById);
router.post('/', authenticateToken, requireRole('SUPER_ADMIN', 'WARDEN'), hostelsController.createHostel);
router.post('/rooms', authenticateToken, requireRole('SUPER_ADMIN', 'WARDEN'), hostelsController.createRoom);
router.delete('/:id', authenticateToken, requireRole('SUPER_ADMIN'), hostelsController.deleteHostel);
router.delete('/rooms/:id', authenticateToken, requireRole('SUPER_ADMIN', 'WARDEN'), hostelsController.deleteRoom);

module.exports = router;
