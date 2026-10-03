const express = require('express');
const router = express.Router();
const config = require('../config');
const notificationService = require('../services/notificationService');
const { authenticate } = require('../middleware/auth');

// Get VAPID public key
router.get('/key', (req, res) => {
  res.json({ publicKey: config.VAPID_PUBLIC_KEY || null });
});

// Subscribe user device to push notifications
router.post('/subscribe', authenticate, (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription) {
      return res.status(400).json({ error: 'Subscription data required.' });
    }
    const result = notificationService.savePushSubscription(req.user.id, subscription);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
