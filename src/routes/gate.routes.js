const express = require('express');
const router = express.Router();
const gateController = require('../controllers/gate.controller');
const { authenticateToken } = require('../middleware/auth');

router.get('/events', authenticateToken, gateController.getGateEvents);
router.get('/live', authenticateToken, gateController.getLiveFeed);
router.get('/export-csv', authenticateToken, gateController.exportMovementCsv);

// TimeWatch Webhook / ADMS PUSH endpoint (publicly accessible by terminal IP)
router.post('/timewatch/push', gateController.handleTimeWatchPushCallback);

module.exports = router;
