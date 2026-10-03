const express = require('express');
const router = express.Router();
const personalService = require('../services/personalService');
const { authenticate } = require('../middleware/auth');

// All routes require authentication
router.use(authenticate);

// 1. Get Personal Dashboard (active cycle, heads, entries, stats)
router.get('/dashboard', (req, res) => {
  try {
    const data = personalService.getPersonalDashboard(req.user.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Create Expense Head
router.post('/heads', (req, res) => {
  try {
    const { name, setAmount } = req.body;
    const head = personalService.createExpenseHead(req.user.id, { name, setAmount });
    res.status(201).json({ head });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 3. Update Expense Head
router.put('/heads/:id', (req, res) => {
  try {
    const { name, setAmount } = req.body;
    const updated = personalService.updateExpenseHead(req.user.id, req.params.id, { name, setAmount });
    res.json({ head: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 4. Delete Expense Head
router.delete('/heads/:id', (req, res) => {
  try {
    const result = personalService.deleteExpenseHead(req.user.id, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 5. Add Spending Entry (with idempotency support for offline sync)
router.post('/expenses', (req, res) => {
  try {
    const { headId, description, amount, idempotencyKey } = req.body;
    const expense = personalService.addPersonalExpense(req.user.id, {
      headId,
      description,
      amount,
      idempotencyKey
    });
    res.status(201).json({ expense });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 6. Update Spending Entry
router.put('/expenses/:id', (req, res) => {
  try {
    const { description, amount } = req.body;
    const updated = personalService.updatePersonalExpense(req.user.id, req.params.id, { description, amount });
    res.json({ expense: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 7. Delete Spending Entry
router.delete('/expenses/:id', (req, res) => {
  try {
    const result = personalService.deletePersonalExpense(req.user.id, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 8. Generate Personal Bill (Atomic billing, immutable snapshot)
router.post('/billing', (req, res) => {
  try {
    const result = personalService.generatePersonalBill(req.user.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 9. Start New Cycle
router.post('/start-new-cycle', (req, res) => {
  try {
    const result = personalService.startNewPersonalCycle(req.user.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
