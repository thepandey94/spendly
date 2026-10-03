const express = require('express');
const router = express.Router();
const analyticsService = require('../services/analyticsService');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// Get analytics data
router.get('/', async (req, res) => {
  try {
    const { filterType, startDate, endDate } = req.query;
    const data = await analyticsService.getAnalytics(req.user.id, {
      filterType: filterType || 'all',
      startDate,
      endDate
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
