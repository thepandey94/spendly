const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db/database');

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. No token provided.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    const user = db.prepare('SELECT id, email, username, display_name, bio, avatar_url, last_username_change, created_at FROM users WHERE id = ?').get(decoded.userId);

    if (!user) {
      return res.status(401).json({ error: 'User account no longer exists.' });
    }

    req.user = user;
    req.token = token;

    // Update last_active_at for session if available
    db.prepare('UPDATE user_sessions SET last_active_at = ? WHERE token = ?').run(Date.now(), token);

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    return res.status(401).json({ error: 'Invalid authentication token.' });
  }
}

module.exports = {
  authenticate
};
