const express = require('express');
const router = express.Router();
const billService = require('../services/billService');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// 1. Get all bills for user (Personal + Group)
router.get('/', (req, res) => {
  try {
    const bills = billService.getUserBills(req.user.id);
    res.json(bills);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Get specific bill details
router.get('/:type/:id', (req, res) => {
  try {
    const details = billService.getBillDetails(req.user.id, req.params.id, req.params.type);
    res.json(details);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// 3. Delete/hide bill record from user's view
router.delete('/:type/:id', (req, res) => {
  try {
    const result = billService.hideUserBill(req.user.id, req.params.id, req.params.type);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
