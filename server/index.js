const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const config = require('./config');
const websocketService = require('./services/websocketService');

// Route imports
const authRoutes = require('./routes/auth');
const personalRoutes = require('./routes/personal');
const groupRoutes = require('./routes/groups');
const billRoutes = require('./routes/bills');
const analyticsRoutes = require('./routes/analytics');
const notificationRoutes = require('./routes/notifications');
const pushRoutes = require('./routes/push');

const app = express();
const server = http.createServer(app);

// Initialize real-time WebSockets
websocketService.init(server);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static assets: uploaded avatars
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
if (process.env.UPLOAD_DIR) {
  // If UPLOAD_DIR is custom (e.g. /data/uploads/avatars), serve parent /data/uploads
  app.use('/uploads', express.static(path.dirname(config.UPLOAD_DIR)));
}

// Serve frontend client files
app.use(express.static(path.join(__dirname, '../client')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'Spendly',
    timestamp: Date.now()
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/personal', personalRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/bills', billRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/push', pushRoutes);

// SPA fallback for HTML5 client navigation
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  if (req.method === 'GET') {
    return res.sendFile(path.join(__dirname, '../client/index.html'));
  }
  next();
});

// Production error handler
app.use((err, req, res, next) => {
  console.error('[Spendly Server Error]', err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'An unexpected internal error occurred.'
  });
});

// Start listening
server.listen(config.PORT, () => {
  console.log(`===============================================`);
  console.log(`🚀 Spendly Server running on port ${config.PORT}`);
  console.log(`📍 Web UI: http://localhost:${config.PORT}`);
  console.log(`📡 WebSocket: ws://localhost:${config.PORT}/ws`);
  console.log(`💾 Database: SQLite (WAL Mode) at ${config.DB_PATH}`);
  console.log(`===============================================`);
});

module.exports = { app, server };
