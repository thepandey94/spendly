const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db/database');

/**
 * Strict Server-Side Administrative Authorization Middleware
 * Enforces:
 * 1. Valid Bearer JWT signed with server JWT_SECRET
 * 2. Active user account in database
 * 3. Verified administrative role (is_admin === true OR email in config.ADMIN_EMAILS)
 */
async function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Administrative authentication required. No token provided.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    if (!decoded || !decoded.userId) {
      return res.status(401).json({ error: 'Malformed authentication token.' });
    }

    const user = await db.prepare(
      'SELECT id, email, username, display_name, bio, avatar_url, is_admin, created_at FROM users WHERE id = ?'
    ).get(decoded.userId);

    if (!user) {
      return res.status(401).json({ error: 'Administrative account no longer exists.' });
    }

    const isAdmin = Boolean(
      user.is_admin ||
      (config.ADMIN_EMAILS && config.ADMIN_EMAILS.includes((user.email || '').toLowerCase()))
    );

    if (!isAdmin) {
      return res.status(403).json({
        error: 'Forbidden: Access denied. Administrative privileges required.'
      });
    }

    // Attach verified admin user object to request
    req.adminUser = {
      ...user,
      is_admin: true
    };
    req.user = req.adminUser;
    req.token = token;

    // Update session timestamp in background
    try {
      await db.prepare('UPDATE user_sessions SET last_active_at = ? WHERE token = ?').run(Date.now(), token);
    } catch (e) {
      // non-blocking session touch
    }

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Admin session expired. Please log in again.' });
    }
    return res.status(401).json({ error: 'Invalid administrative token.' });
  }
}

module.exports = {
  authenticateAdmin
};
