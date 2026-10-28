const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reports.controller');
const { authenticateToken } = require('../middleware/auth');

router.get('/daily-movements', authenticateToken, reportsController.getDailyMovementReport);
router.get('/headcount', authenticateToken, reportsController.getHeadcountReport);
router.get('/outings', authenticateToken, reportsController.getOutingsAnalytics);
router.get('/denied-access', authenticateToken, reportsController.getDeniedAccessReport);
router.get('/export-csv', authenticateToken, reportsController.exportCustomReportCsv);

module.exports = router;
