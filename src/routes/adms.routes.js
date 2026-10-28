const express = require('express');
const router = express.Router();
const admsService = require('../services/admsService');

// Terminal Handshake and Option Fetch: GET /iclock/cdata?SN=...
router.get('/cdata', (req, res) => admsService.handleHandshake(req, res));

// Terminal Push Data (Attendance Logs): POST /iclock/cdata?SN=...&table=ATTLOG
router.post('/cdata', (req, res) => admsService.handlePunchLogs(req, res));

// Command Polling: GET /iclock/getrequest?SN=...
router.get('/getrequest', (req, res) => admsService.handleGetRequest(req, res));

// Command Execution Acknowledgment: POST /iclock/devicecmd?SN=...
router.post('/devicecmd', (req, res) => admsService.handleDeviceCmd(req, res));

// Photo / Biometric Capture Upload: POST /iclock/fdata
router.post('/fdata', (req, res) => admsService.handleFData(req, res));

// Terminal Ping / Liveness Check
router.all('/ping', (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.status(200).send('OK');
});

module.exports = router;
