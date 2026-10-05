const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const config = require('./config');
const websocketService = require('./services/websocketService');

const fs = require('fs');
const db = require('./db/database');

// Route imports
const authRoutes = require('./routes/auth');
const personalRoutes = require('./routes/personal');
const groupRoutes = require('./routes/groups');
const billRoutes = require('./routes/bills');
const analyticsRoutes = require('./routes/analytics');
const notificationRoutes = require('./routes/notifications');
const pushRoutes = require('./routes/push');
const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/users');

const app = express();
const server = http.createServer(app);

// Initialize real-time WebSockets
websocketService.init(server);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Dedicated persistent avatar serving route (Disk Cache + Neon PostgreSQL database fallback for Render ephemerality)
app.get('/uploads/avatars/:filename', async (req, res) => {
  const { filename } = req.params;
  const localPath = path.join(config.UPLOAD_DIR, filename);

  // 1. If present on disk cache, serve immediately
  if (fs.existsSync(localPath)) {
    return res.sendFile(localPath);
  }

  // 2. If not on disk (e.g. Render restart/redeploy), fetch from database
  try {
    const avatar = await db.prepare(
      'SELECT mime_type, image_data FROM user_avatars WHERE filename = ?'
    ).get(filename);

    if (avatar && avatar.image_data) {
      const buffer = Buffer.from(avatar.image_data, 'base64');
      // Cache back to local disk
      try {
        if (!fs.existsSync(config.UPLOAD_DIR)) {
          fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });
        }
        fs.writeFileSync(localPath, buffer);
      } catch (writeErr) {
        // Non-fatal if filesystem is restricted
      }
      res.set('Content-Type', avatar.mime_type || 'image/jpeg');
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(buffer);
    }
  } catch (err) {
    console.error('[Avatar Serve Error]', err);
  }

  // 3. If file not found anywhere, return 404 JSON (NEVER return index.html)
  return res.status(404).json({ error: 'Avatar image not found' });
});

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
app.use('/api/users', userRoutes);
app.use('/api/personal', personalRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/bills', billRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/admin', adminRoutes);

// SPA fallback for HTML5 client navigation
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) {
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

const db = require('./db/database');

// Start listening on 0.0.0.0 to satisfy Render container port routing
async function startServer() {
  const HOST = '0.0.0.0';
  server.listen(config.PORT, HOST, async () => {
    console.log(`===============================================`);
    console.log(`🚀 Spendly Server running on ${HOST}:${config.PORT}`);
    console.log(`📍 Web UI: http://${HOST}:${config.PORT}`);
    console.log(`📡 WebSocket: ws://${HOST}:${config.PORT}/ws`);
    console.log(`💾 Database: ${db.isPostgres ? 'PostgreSQL' : `SQLite (WAL Mode) at ${config.DB_PATH}`}`);
    console.log(`===============================================`);

    try {
      await db.init();
      console.log('✅ Database initialized and verified');
    } catch (dbErr) {
      console.error('[Spendly Database Init Warning]', dbErr);
    }
  });
}

startServer().catch((err) => {
  console.error('[Spendly Fatal Startup Error]', err);
  process.exit(1);
});

module.exports = { app, server };
