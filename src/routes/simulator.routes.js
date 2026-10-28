const express = require('express');
const router = express.Router();
const simulatorController = require('../controllers/simulator.controller');
const { authenticateToken } = require('../middleware/auth');

router.post('/scan', authenticateToken, simulatorController.triggerScan);
router.post('/scenario', authenticateToken, simulatorController.runScenario);
router.post('/toggle-device', authenticateToken, simulatorController.toggleDeviceState);

module.exports = router;
