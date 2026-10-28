const express = require('express');
const router = express.Router();
const incidentsController = require('../controllers/incidents.controller');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

router.get('/', authenticateToken, incidentsController.getIncidents);
router.post('/', authenticateToken, requireRole('SUPER_ADMIN', 'WARDEN'), incidentsController.createIncident);
router.put('/:id', authenticateToken, requireRole('SUPER_ADMIN', 'WARDEN'), incidentsController.updateIncident);

module.exports = router;
