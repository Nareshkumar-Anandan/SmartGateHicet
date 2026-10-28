const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const { testConnection } = require('./config/database');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 5000;
const API_PREFIX = process.env.API_PREFIX || '/api/v1';

// Middlewares
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.text({ type: ['text/*', 'application/octet-stream', 'text/plain'], limit: '10mb' }));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Static files for student avatars and uploaded face photos
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));

// TimeWatch ADMS / iclock Cloud Push Protocol (Root level mount)
app.use('/iclock', require('./routes/adms.routes'));

// System Health Check
app.get(`${API_PREFIX}/health`, async (req, res) => {
  const dbOk = await testConnection();
  const os = require('os');
  const ifaces = os.networkInterfaces();
  let localIp = '127.0.0.1';
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIp = iface.address;
      }
    }
  }

  return res.json({
    status: 'UP',
    system: 'Smart Hostel Gate Management System',
    institution: 'Hindusthan Institute of Technology (HICET)',
    timestamp: new Date().toISOString(),
    database: dbOk ? 'CONNECTED' : 'DISCONNECTED',
    serverIp: localIp,
    deviceAdapter: 'TimeWatch TrueFace3000 (ADPM) & Tripod Turnstile Bridge'
  });
});

// Mount Routes
app.use(`${API_PREFIX}/auth`, require('./routes/auth.routes'));
app.use(`${API_PREFIX}/dashboard`, require('./routes/dashboard.routes'));
app.use(`${API_PREFIX}/students`, require('./routes/students.routes'));
app.use(`${API_PREFIX}/hostels`, require('./routes/hostels.routes'));
app.use(`${API_PREFIX}/outings`, require('./routes/outings.routes'));
app.use(`${API_PREFIX}/gate`, require('./routes/gate.routes'));
app.use(`${API_PREFIX}/devices`, require('./routes/devices.routes'));
app.use(`${API_PREFIX}/simulator`, require('./routes/simulator.routes'));
app.use(`${API_PREFIX}/reports`, require('./routes/reports.routes'));
app.use(`${API_PREFIX}/incidents`, require('./routes/incidents.routes'));
app.use(`${API_PREFIX}/audit`, require('./routes/audit.routes'));
app.use(`${API_PREFIX}/users`, require('./routes/users.routes'));
app.use(`${API_PREFIX}/settings`, require('./routes/settings.routes'));
app.use(`${API_PREFIX}/timewatch`, require('./routes/timewatch.routes'));

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `API endpoint '${req.originalUrl}' not found.`
  });
});

// Centralized Error Handler
app.use(errorHandler);

if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(PORT, async () => {
    console.log(`========================================================`);
    console.log(`SmartGate Backend Server running on port ${PORT}`);
    console.log(`API Base URL: http://localhost:${PORT}${API_PREFIX}`);
    console.log(`Institution: Hindusthan Institute of Technology (HICET)`);
    console.log(`========================================================`);
    const dbConnected = await testConnection();
    if (dbConnected) {
      console.log('MySQL Database Connected Successfully.');
    } else {
      console.error('MySQL Database Connection Failed. Please check .env credentials.');
    }

    // Start Auto-Registration TCP listener for TimeWatch / Dahua terminals
    const autoRegisterService = require('./services/autoRegisterService');
    autoRegisterService.start();

    // Start built-in TimeWatch Web API (TWAPI) server on port 8001
    const twapiServerService = require('./services/twapiServerService');
    twapiServerService.start();

    // Start TimeWatch iDMS Server live sync worker (172.25.3.51:9001)
    if (process.env.TIMEWATCH_LIVE_SYNC_ENABLED === 'true') {
      const timewatchIdmsService = require('./services/timewatchIdmsService');
      timewatchIdmsService.startLiveSync();
    }
  });

  // Catch non-HTTP raw TCP packets from terminal if sent to port 5000
  server.on('clientError', (err, socket) => {
    const clientIp = socket.remoteAddress ? socket.remoteAddress.replace(/^.*:/, '') : '';
    console.log(`[RAW TCP / CLIENT ERROR on Port 5000] from ${clientIp}: ${err.message}`);
    const fs = require('fs');
    fs.appendFileSync(
      path.resolve(__dirname, '../device_traffic.log'),
      `[${new Date().toISOString()}] Port 5000 ClientError from ${clientIp}: ${err.message}\n`
    );
    socket.end();
  });
}

module.exports = app;
