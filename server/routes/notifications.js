const express = require('express');
const router = express.Router();
const notificationService = require('../services/notificationService');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// 1. Get user notifications
router.get('/', (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const data = notificationService.getUserNotifications(req.user.id, limit);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Mark notifications as read
router.post('/mark-read', (req, res) => {
  try {
    const { notificationId } = req.body;
    const result = notificationService.markAsRead(req.user.id, notificationId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
