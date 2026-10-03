const crypto = require('crypto');
const db = require('../db/database');
const config = require('../config');

/**
 * Helper to convert rupee decimal (or integer) to integer paise
 * Handles negative input by converting to positive absolute value
 */
function toPaise(rupees) {
  if (rupees === null || rupees === undefined || isNaN(rupees)) {
    return 0;
  }
  const abs = Math.abs(parseFloat(rupees));
  return Math.round(abs * 100);
}

/**
 * Get or initialize current active personal cycle for user
 */
function getActiveCycle(userId) {
  let cycle = db.prepare(`
    SELECT * FROM personal_cycles 
    WHERE user_id = ? AND status = 'active'
    ORDER BY cycle_number DESC 
    LIMIT 1
  `).get(userId);

  if (!cycle) {
    // Check if there's any completed cycle
    const lastCycle = db.prepare(`
      SELECT cycle_number, status FROM personal_cycles 
      WHERE user_id = ? 
      ORDER BY cycle_number DESC 
      LIMIT 1
    `).get(userId);

    if (lastCycle && lastCycle.status === 'billed') {
      // Cycle was billed and user hasn't clicked "Start a New Cycle" yet
      return null;
    }

    // Otherwise create initial cycle #1
    const newCycleId = crypto.randomUUID();
    const cycleNum = lastCycle ? lastCycle.cycle_number + 1 : 1;
    const now = Date.now();

    db.prepare(`
      INSERT INTO personal_cycles (id, user_id, cycle_number, status, created_at)
      VALUES (?, ?, ?, 'active', ?)
    `).run(newCycleId, userId, cycleNum, now);

    cycle = db.prepare('SELECT * FROM personal_cycles WHERE id = ?').get(newCycleId);
  }

  return cycle;
}

/**
 * Get latest completed cycle (for displaying the prompt to start a new cycle)
 */
function getLatestCompletedCycle(userId) {
  return db.prepare(`
    SELECT pc.*, pb.id as bill_id, pb.total_spent, pb.total_set_amount 
    FROM personal_cycles pc
    LEFT JOIN personal_bills pb ON pb.cycle_id = pc.id
    WHERE pc.user_id = ? AND pc.status = 'billed'
    ORDER BY pc.cycle_number DESC 
    LIMIT 1
  `).get(userId);
}

/**
 * Fetch full personal dashboard data for active cycle:
 * Heads with spent, remaining, overspent, entries, cycle stats
 */
function getPersonalDashboard(userId) {
  const activeCycle = getActiveCycle(userId);

  if (!activeCycle) {
    // User needs to start a new cycle after previous billing
    const lastBilled = getLatestCompletedCycle(userId);
    return {
      hasActiveCycle: false,
      lastBilledCycle: lastBilled,
      heads: [],
      totals: {
        totalSetAmount: 0,
        totalSpent: 0,
        totalRemaining: 0,
        totalOverspent: 0,
        entryCount: 0
      }
    };
  }

  // Fetch expense heads for this cycle
  const heads = db.prepare(`
    SELECT * FROM personal_expense_heads 
    WHERE cycle_id = ? 
    ORDER BY created_at ASC
  `).all(activeCycle.id);

  // Fetch all spending entries for this cycle
  const expenses = db.prepare(`
    SELECT * FROM personal_expenses 
    WHERE cycle_id = ? 
    ORDER BY created_at DESC
  `).all(activeCycle.id);

  // Map expenses to heads and calculate totals
  const expensesByHead = new Map();
  expenses.forEach(exp => {
    if (!expensesByHead.has(exp.head_id)) {
      expensesByHead.set(exp.head_id, []);
    }
    expensesByHead.get(exp.head_id).push(exp);
  });

  let totalSetAmount = 0;
  let totalSpent = 0;
  let totalRemaining = 0;
  let totalOverspent = 0;

  const headsWithStats = heads.map(head => {
    const headExpenses = expensesByHead.get(head.id) || [];
    const spent = headExpenses.reduce((sum, e) => sum + e.amount, 0);
    const setAmount = head.set_amount;

    let remaining = 0;
    let overspent = 0;

    if (setAmount >= spent) {
      remaining = setAmount - spent;
    } else {
      overspent = spent - setAmount;
    }

    totalSetAmount += setAmount;
    totalSpent += spent;
    totalRemaining += remaining;
    totalOverspent += overspent;

    return {
      id: head.id,
      name: head.name,
      setAmount, // paise
      spent,     // paise
      remaining, // paise
      overspent, // paise
      entries: headExpenses
    };
  });

  return {
    hasActiveCycle: true,
    cycle: activeCycle,
    heads: headsWithStats,
    totals: {
      totalSetAmount,
      totalSpent,
      totalRemaining,
      totalOverspent,
      entryCount: expenses.length
    }
  };
}

/**
 * Create a new expense head in current active cycle
 */
function createExpenseHead(userId, { name, setAmount }) {
  if (!name || !name.trim()) {
    throw new Error('Expense head name is required.');
  }

  const activeCycle = getActiveCycle(userId);
  if (!activeCycle) {
    throw new Error('No active cycle. Please start a new cycle first.');
  }

  const amountPaise = toPaise(setAmount);
  const id = crypto.randomUUID();
  const now = Date.now();

  db.prepare(`
    INSERT INTO personal_expense_heads (id, cycle_id, user_id, name, set_amount, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, activeCycle.id, userId, name.trim(), amountPaise, now);

  return db.prepare('SELECT * FROM personal_expense_heads WHERE id = ?').get(id);
}

/**
 * Edit an expense head (name / setAmount)
 */
function updateExpenseHead(userId, headId, { name, setAmount }) {
  const head = db.prepare(`
    SELECT peh.*, pc.status as cycle_status 
    FROM personal_expense_heads peh
    JOIN personal_cycles pc ON pc.id = peh.cycle_id
    WHERE peh.id = ? AND peh.user_id = ?
  `).get(headId, userId);

  if (!head) {
    throw new Error('Expense head not found.');
  }

  if (head.cycle_status !== 'active') {
    throw new Error('Cannot edit an expense head from a completed/billed cycle.');
  }

  const updates = [];
  const params = [];

  if (name && name.trim()) {
    updates.push('name = ?');
    params.push(name.trim());
  }

  if (setAmount !== undefined && setAmount !== null) {
    updates.push('set_amount = ?');
    params.push(toPaise(setAmount));
  }

  if (updates.length > 0) {
    params.push(headId);
    params.push(userId);
    db.prepare(`
      UPDATE personal_expense_heads 
      SET ${updates.join(', ')} 
      WHERE id = ? AND user_id = ?
    `).run(...params);
  }

  return db.prepare('SELECT * FROM personal_expense_heads WHERE id = ?').get(headId);
}

/**
 * Delete an expense head (and its entries)
 */
function deleteExpenseHead(userId, headId) {
  const head = db.prepare(`
    SELECT peh.*, pc.status as cycle_status 
    FROM personal_expense_heads peh
    JOIN personal_cycles pc ON pc.id = peh.cycle_id
    WHERE peh.id = ? AND peh.user_id = ?
  `).get(headId, userId);

  if (!head) {
    throw new Error('Expense head not found.');
  }

  if (head.cycle_status !== 'active') {
    throw new Error('Cannot delete an expense head from a completed/billed cycle.');
  }

  db.transaction(() => {
    db.prepare('DELETE FROM personal_expenses WHERE head_id = ?').run(headId);
    db.prepare('DELETE FROM personal_expense_heads WHERE id = ?').run(headId);
  })();

  return { success: true };
}

/**
 * Add a spending entry (enforces 10,000 entries limit, idempotency support)
 */
function addPersonalExpense(userId, { headId, description, amount, idempotencyKey = null }) {
  if (!headId) {
    throw new Error('Please select an expense head.');
  }
  if (!description || !description.trim()) {
    throw new Error('Description is required.');
  }

  const amountPaise = toPaise(amount);
  if (amountPaise <= 0) {
    throw new Error('Amount must be greater than zero.');
  }

  // Idempotency check: if this operation was already processed, return existing
  if (idempotencyKey) {
    const existing = db.prepare('SELECT * FROM personal_expenses WHERE idempotency_key = ?').get(idempotencyKey);
    if (existing) {
      return existing;
    }
  }

  const head = db.prepare(`
    SELECT peh.*, pc.status as cycle_status 
    FROM personal_expense_heads peh
    JOIN personal_cycles pc ON pc.id = peh.cycle_id
    WHERE peh.id = ? AND peh.user_id = ?
  `).get(headId, userId);

  if (!head) {
    throw new Error('Expense head not found.');
  }

  if (head.cycle_status !== 'active') {
    throw new Error('This cycle is already billed. Please start a new cycle to add expenses.');
  }

  // Check 10,000 entry limit per personal cycle
  const currentCount = db.prepare(`
    SELECT COUNT(*) as count FROM personal_expenses WHERE cycle_id = ?
  `).get(head.cycle_id).count;

  if (currentCount >= config.MAX_PERSONAL_CYCLE_ENTRIES) {
    throw new Error(`Personal cycle limit of ${config.MAX_PERSONAL_CYCLE_ENTRIES.toLocaleString()} entries reached. Please bill this cycle and start a new cycle.`);
  }

  const id = crypto.randomUUID();
  const now = Date.now();

  db.prepare(`
    INSERT INTO personal_expenses (id, cycle_id, head_id, user_id, description, amount, idempotency_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, head.cycle_id, headId, userId, description.trim(), amountPaise, idempotencyKey, now);

  return db.prepare('SELECT * FROM personal_expenses WHERE id = ?').get(id);
}

/**
 * Edit a spending entry
 */
function updatePersonalExpense(userId, expenseId, { description, amount }) {
  const expense = db.prepare(`
    SELECT pe.*, pc.status as cycle_status 
    FROM personal_expenses pe
    JOIN personal_cycles pc ON pc.id = pe.cycle_id
    WHERE pe.id = ? AND pe.user_id = ?
  `).get(expenseId, userId);

  if (!expense) {
    throw new Error('Expense entry not found.');
  }

  if (expense.cycle_status !== 'active') {
    throw new Error('Cannot edit an expense from a billed cycle.');
  }

  const updates = [];
  const params = [];

  if (description && description.trim()) {
    updates.push('description = ?');
    params.push(description.trim());
  }

  if (amount !== undefined && amount !== null) {
    const amountPaise = toPaise(amount);
    if (amountPaise <= 0) {
      throw new Error('Amount must be greater than zero.');
    }
    updates.push('amount = ?');
    params.push(amountPaise);
  }

  if (updates.length > 0) {
    params.push(expenseId);
    params.push(userId);
    db.prepare(`
      UPDATE personal_expenses 
      SET ${updates.join(', ')} 
      WHERE id = ? AND user_id = ?
    `).run(...params);
  }

  return db.prepare('SELECT * FROM personal_expenses WHERE id = ?').get(expenseId);
}

/**
 * Delete a spending entry permanently
 */
function deletePersonalExpense(userId, expenseId) {
  const expense = db.prepare(`
    SELECT pe.*, pc.status as cycle_status 
    FROM personal_expenses pe
    JOIN personal_cycles pc ON pc.id = pe.cycle_id
    WHERE pe.id = ? AND pe.user_id = ?
  `).get(expenseId, userId);

  if (!expense) {
    throw new Error('Expense entry not found.');
  }

  if (expense.cycle_status !== 'active') {
    throw new Error('Cannot delete an expense from a billed cycle.');
  }

  db.prepare('DELETE FROM personal_expenses WHERE id = ? AND user_id = ?').run(expenseId, userId);
  return { success: true };
}

/**
 * Personal Billing: Atomic generation of permanent immutable bill (Sections 22 - 24)
 */
function generatePersonalBill(userId) {
  const activeCycle = db.prepare(`
    SELECT * FROM personal_cycles 
    WHERE user_id = ? AND status = 'active'
  `).get(userId);

  if (!activeCycle) {
    throw new Error('No active cycle found to bill.');
  }

  // Check if a bill already exists for this cycle (idempotency guard)
  const existingBill = db.prepare('SELECT * FROM personal_bills WHERE cycle_id = ?').get(activeCycle.id);
  if (existingBill) {
    return {
      bill: existingBill,
      snapshot: JSON.parse(existingBill.bill_snapshot_json)
    };
  }

  const user = db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(userId);

  // Fetch heads and expenses
  const heads = db.prepare('SELECT * FROM personal_expense_heads WHERE cycle_id = ?').all(activeCycle.id);
  const expenses = db.prepare('SELECT * FROM personal_expenses WHERE cycle_id = ? ORDER BY created_at ASC').all(activeCycle.id);

  const expensesByHead = new Map();
  expenses.forEach(e => {
    if (!expensesByHead.has(e.head_id)) {
      expensesByHead.set(e.head_id, []);
    }
    expensesByHead.get(e.head_id).push({
      id: e.id,
      description: e.description,
      amount: e.amount,
      createdAt: e.created_at
    });
  });

  let totalSetAmount = 0;
  let totalSpent = 0;
  let totalRemaining = 0;
  let totalOverspent = 0;

  const headsSnapshot = heads.map(h => {
    const items = expensesByHead.get(h.id) || [];
    const spent = items.reduce((sum, item) => sum + item.amount, 0);
    const setAmount = h.set_amount;
    const remaining = setAmount >= spent ? setAmount - spent : 0;
    const overspent = spent > setAmount ? spent - setAmount : 0;

    totalSetAmount += setAmount;
    totalSpent += spent;
    totalRemaining += remaining;
    totalOverspent += overspent;

    return {
      id: h.id,
      name: h.name,
      setAmount,
      spent,
      remaining,
      overspent,
      items
    };
  });

  const now = Date.now();
  const billId = crypto.randomUUID();

  // Create complete immutable historical snapshot
  const snapshot = {
    billId,
    cycleId: activeCycle.id,
    cycleNumber: activeCycle.cycle_number,
    billedAt: now,
    userSnapshot: {
      username: user.username,
      displayName: user.display_name
    },
    totals: {
      totalSetAmount,
      totalSpent,
      totalRemaining,
      totalOverspent,
      entryCount: expenses.length
    },
    heads: headsSnapshot
  };

  const snapshotJson = JSON.stringify(snapshot);

  // Execute billing atomically: lock cycle, insert immutable bill
  const billingTx = db.transaction(() => {
    // 1. Lock cycle
    db.prepare(`
      UPDATE personal_cycles 
      SET status = 'billed', billed_at = ? 
      WHERE id = ? AND status = 'active'
    `).run(now, activeCycle.id);

    // 2. Insert immutable bill
    db.prepare(`
      INSERT INTO personal_bills (
        id, cycle_id, user_id, cycle_number, 
        total_set_amount, total_spent, total_remaining, total_overspent, 
        entry_count, bill_snapshot_json, hidden_by_user, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      billId, activeCycle.id, userId, activeCycle.cycle_number,
      totalSetAmount, totalSpent, totalRemaining, totalOverspent,
      expenses.length, snapshotJson, now
    );
  });

  billingTx();

  const savedBill = db.prepare('SELECT * FROM personal_bills WHERE id = ?').get(billId);

  return {
    bill: savedBill,
    snapshot
  };
}

/**
 * Start a New Cycle after billing
 * Copies existing expense heads into new active cycle with fresh 0 balance
 */
function startNewPersonalCycle(userId) {
  const activeCycle = db.prepare(`
    SELECT * FROM personal_cycles WHERE user_id = ? AND status = 'active'
  `).get(userId);

  if (activeCycle) {
    throw new Error('An active cycle is already in progress. Complete billing before starting a new cycle.');
  }

  const lastCycle = db.prepare(`
    SELECT * FROM personal_cycles 
    WHERE user_id = ? 
    ORDER BY cycle_number DESC 
    LIMIT 1
  `).get(userId);

  const nextCycleNumber = lastCycle ? lastCycle.cycle_number + 1 : 1;
  const newCycleId = crypto.randomUUID();
  const now = Date.now();

  const startTx = db.transaction(() => {
    // 1. Create new cycle
    db.prepare(`
      INSERT INTO personal_cycles (id, user_id, cycle_number, status, created_at)
      VALUES (?, ?, ?, 'active', ?)
    `).run(newCycleId, userId, nextCycleNumber, now);

    // 2. Carry over existing expense heads from previous cycle so user does not need to retype them
    if (lastCycle) {
      const prevHeads = db.prepare('SELECT name, set_amount FROM personal_expense_heads WHERE cycle_id = ?').all(lastCycle.id);
      for (const h of prevHeads) {
        const headId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO personal_expense_heads (id, cycle_id, user_id, name, set_amount, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(headId, newCycleId, userId, h.name, h.set_amount, now);
      }
    }
  });

  startTx();

  return getPersonalDashboard(userId);
}

module.exports = {
  toPaise,
  getActiveCycle,
  getPersonalDashboard,
  createExpenseHead,
  updateExpenseHead,
  deleteExpenseHead,
  addPersonalExpense,
  updatePersonalExpense,
  deletePersonalExpense,
  generatePersonalBill,
  startNewPersonalCycle
};
