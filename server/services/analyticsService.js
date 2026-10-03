const db = require('../db/database');

/**
 * Get comprehensive analytics with time filtering
 * @param {string} userId 
 * @param {{filterType: string, startDate?: number, endDate?: number}} filter 
 */
async function getAnalytics(userId, { filterType = 'all', startDate = null, endDate = null }) {
  const now = new Date();
  let timeClause = '';
  const params = [userId];

  if (filterType === 'today') {
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    timeClause = 'AND created_at >= ?';
    params.push(startOfDay);
  } else if (filterType === 'month') {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    timeClause = 'AND created_at >= ?';
    params.push(startOfMonth);
  } else if (filterType === 'custom' && startDate && endDate) {
    timeClause = 'AND created_at >= ? AND created_at <= ?';
    params.push(parseInt(startDate, 10));
    params.push(parseInt(endDate, 10));
  }

  // 1. Personal Spending within time window
  const personalExpenses = await db.prepare(`
    SELECT pe.*, peh.name as head_name, peh.set_amount
    FROM personal_expenses pe
    JOIN personal_expense_heads peh ON peh.id = pe.head_id
    WHERE pe.user_id = ? ${timeClause}
  `).all(...params);

  const personalTotal = personalExpenses.reduce((sum, e) => sum + e.amount, 0);

  // Group personal spending by expense head
  const personalByHeadMap = new Map();
  personalExpenses.forEach(e => {
    if (!personalByHeadMap.has(e.head_name)) {
      personalByHeadMap.set(e.head_name, {
        name: e.head_name,
        setAmount: e.set_amount,
        spent: 0
      });
    }
    personalByHeadMap.get(e.head_name).spent += e.amount;
  });

  const personalHeadsAnalytics = Array.from(personalByHeadMap.values()).map(h => {
    const remaining = h.setAmount >= h.spent ? h.setAmount - h.spent : 0;
    const overspent = h.spent > h.setAmount ? h.spent - h.setAmount : 0;
    return {
      name: h.name,
      setAmount: h.setAmount,
      spent: h.spent,
      remaining,
      overspent
    };
  });

  // 2. Group Spending where user participated
  const groupExpenses = await db.prepare(`
    SELECT ge.*, g.name as group_name
    FROM group_expenses ge
    JOIN groups g ON g.id = ge.group_id
    WHERE ge.user_id = ? ${timeClause}
  `).all(...params);

  const userGroupSpent = groupExpenses.reduce((sum, e) => sum + e.amount, 0);

  // 3. User Group Balances and Debts across active groups & bills
  // Fetch active settlements where user is payer or receiver
  const payerRow = await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as totalOwed
    FROM settlements
    WHERE payer_id = ? AND status != 'completed'
  `).get(userId);
  const pendingSettlementsAsPayer = payerRow ? payerRow.totalOwed : 0;

  const receiverRow = await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as totalReceivable
    FROM settlements
    WHERE receiver_id = ? AND status != 'completed'
  `).get(userId);
  const pendingSettlementsAsReceiver = receiverRow ? receiverRow.totalReceivable : 0;

  // Group summary by group
  const userGroups = await db.prepare(`
    SELECT g.id, g.name
    FROM group_members gm
    JOIN groups g ON g.id = gm.group_id
    WHERE gm.user_id = ? AND gm.status = 'active' AND g.deleted_at IS NULL
  `).all(userId);

  const groupAnalyticsList = await Promise.all(userGroups.map(async (g) => {
    // Total spent in group during time filter
    const totalGroupSpentRow = await db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM group_expenses
      WHERE group_id = ? ${timeClause.replace('pe.', '').replace('created_at', 'created_at')}
    `).get(g.id, ...params.slice(1));

    // User's contribution in group
    const userContributionRow = await db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM group_expenses
      WHERE group_id = ? AND user_id = ? ${timeClause.replace('pe.', '').replace('created_at', 'created_at')}
    `).get(g.id, userId, ...params.slice(1));

    // Active members count
    const memberCountRow = await db.prepare(`
      SELECT COUNT(*) as count FROM group_members WHERE group_id = ? AND status = 'active'
    `).get(g.id);
    const memberCount = (memberCountRow && memberCountRow.count) ? memberCountRow.count : 1;

    const groupTotal = totalGroupSpentRow ? totalGroupSpentRow.total : 0;
    const userSpent = userContributionRow ? userContributionRow.total : 0;
    const userShare = Math.floor(groupTotal / memberCount);

    return {
      groupId: g.id,
      groupName: g.name,
      groupTotal,
      userContribution: userSpent,
      userEqualShare: userShare,
      netDifference: userSpent - userShare
    };
  }));

  // Overall totals
  const overallTotal = personalTotal + userGroupSpent;

  return {
    filterType,
    overall: {
      totalSpending: overallTotal,
      personalSpending: personalTotal,
      groupSpending: userGroupSpent,
      totalOwed: pendingSettlementsAsPayer,
      totalReceivable: pendingSettlementsAsReceiver
    },
    personalHeads: personalHeadsAnalytics,
    groups: groupAnalyticsList
  };
}

module.exports = {
  getAnalytics
};
