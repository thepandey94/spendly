const express = require('express');
const router = express.Router();
const personalService = require('../services/personalService');
const { authenticate } = require('../middleware/auth');

// All routes require authentication
router.use(authenticate);

// 1. Get Personal Dashboard (active cycle, heads, entries, stats)
router.get('/dashboard', async (req, res) => {
  try {
    const data = await personalService.getPersonalDashboard(req.user.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Create Expense Head
router.post('/heads', async (req, res) => {
  try {
    const { name, setAmount } = req.body;
    const head = await personalService.createExpenseHead(req.user.id, { name, setAmount });
    res.status(201).json({ head });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 3. Update Expense Head
router.put('/heads/:id', async (req, res) => {
  try {
    const { name, setAmount } = req.body;
    const updated = await personalService.updateExpenseHead(req.user.id, req.params.id, { name, setAmount });
    res.json({ head: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 4. Delete Expense Head
router.delete('/heads/:id', async (req, res) => {
  try {
    const result = await personalService.deleteExpenseHead(req.user.id, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 5. Add Spending Entry (with idempotency support for offline sync)
router.post('/expenses', async (req, res) => {
  try {
    const { headId, description, amount, idempotencyKey } = req.body;
    const expense = await personalService.addPersonalExpense(req.user.id, {
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
router.put('/expenses/:id', async (req, res) => {
  try {
    const { description, amount } = req.body;
    const updated = await personalService.updatePersonalExpense(req.user.id, req.params.id, { description, amount });
    res.json({ expense: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 7. Delete Spending Entry
router.delete('/expenses/:id', async (req, res) => {
  try {
    const result = await personalService.deletePersonalExpense(req.user.id, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 8. Generate Personal Bill (Atomic billing, immutable snapshot)
router.post('/billing', async (req, res) => {
  try {
    const result = await personalService.generatePersonalBill(req.user.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 9. Start New Cycle
router.post('/start-new-cycle', async (req, res) => {
  try {
    const result = await personalService.startNewPersonalCycle(req.user.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
