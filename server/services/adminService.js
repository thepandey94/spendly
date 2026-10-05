const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/database');
const config = require('../config');

/**
 * Spendly Admin Service
 * Handles administrative authentication, analytics aggregation,
 * user management, session inspection, and audit logging.
 */

/**
 * Verify if a user object has admin privileges
 */
function isAdmin(user) {
  if (!user) return false;
  if (user.is_admin === true || user.is_admin === 1) return true;
  if (config.ADMIN_EMAILS && config.ADMIN_EMAILS.includes((user.email || '').toLowerCase())) {
    return true;
  }
  return false;
}

/**
 * Record an administrative audit log
 */
async function logAudit({
  adminId,
  adminUsername,
  action,
  targetType = null,
  targetId = null,
  details = null,
  ipAddress = null,
  status = 'success'
}) {
  try {
    const id = crypto.randomUUID();
    const now = Date.now();
    const detailsJson = details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null;

    await db.prepare(`
      INSERT INTO admin_audit_logs (id, admin_id, admin_username, action, target_type, target_id, details_json, ip_address, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, adminId, adminUsername, action, targetType, targetId, detailsJson, ipAddress, status, now);

    return { id, success: true };
  } catch (err) {
    console.error('[Spendly Admin Audit Log Error]', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Admin Login
 */
async function adminLogin({ identifier, password, ipAddress = null, userAgent = 'Admin Console' }) {
  if (!identifier || !password) {
    throw new Error('Please provide admin username/email and password.');
  }

  const cleanIdentifier = identifier.trim().toLowerCase();

  const user = await db.prepare(`
    SELECT * FROM users 
    WHERE email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE
  `).get(cleanIdentifier, cleanIdentifier);

  if (!user) {
    throw new Error('Invalid administrative credentials.');
  }

  const isPasswordValid = bcrypt.compareSync(password, user.password_hash);
  if (!isPasswordValid) {
    await logAudit({
      adminId: user.id,
      adminUsername: user.username,
      action: 'admin_login_failed',
      targetType: 'auth',
      targetId: user.id,
      details: { reason: 'invalid_password' },
      ipAddress,
      status: 'failed'
    });
    throw new Error('Invalid administrative credentials.');
  }

  if (!isAdmin(user)) {
    await logAudit({
      adminId: user.id,
      adminUsername: user.username,
      action: 'admin_login_denied',
      targetType: 'auth',
      targetId: user.id,
      details: { reason: 'not_an_admin' },
      ipAddress,
      status: 'forbidden'
    });
    throw new Error('Access denied. Administrative privileges required.');
  }

  // Generate Admin JWT Token
  const token = jwt.sign(
    { userId: user.id, username: user.username, email: user.email, isAdmin: true },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_IN }
  );

  const sessionId = crypto.randomUUID();
  const now = Date.now();
  const deviceInfo = `Admin Console (${(userAgent || 'Desktop').slice(0, 80)})`;

  await db.prepare(`
    INSERT INTO user_sessions (id, user_id, device_info, token, created_at, last_active_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sessionId, user.id, deviceInfo, token, now, now);

  await logAudit({
    adminId: user.id,
    adminUsername: user.username,
    action: 'admin_login',
    targetType: 'session',
    targetId: sessionId,
    details: { deviceInfo },
    ipAddress,
    status: 'success'
  });

  const { password_hash, ...safeUser } = user;
  safeUser.is_admin = true;

  return {
    user: safeUser,
    token,
    sessionId
  };
}

/**
 * Get Overall Dashboard Metrics and Aggregations
 */
async function getDashboardMetrics({ timeRange = '30d' } = {}) {
  const now = Date.now();
  let timeWindowMs = 30 * 24 * 60 * 60 * 1000;
  if (timeRange === '7d') timeWindowMs = 7 * 24 * 60 * 60 * 1000;
  else if (timeRange === '90d') timeWindowMs = 90 * 24 * 60 * 60 * 1000;
  else if (timeRange === 'this_year') timeWindowMs = 365 * 24 * 60 * 60 * 1000;

  const windowStartTime = now - timeWindowMs;
  const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

  // 1. User metrics
  const totalUsersRow = await db.prepare('SELECT COUNT(*) as count FROM users').get();
  const activeUsersRow = await db.prepare(
    'SELECT COUNT(DISTINCT user_id) as count FROM user_sessions WHERE last_active_at >= ?'
  ).get(thirtyDaysAgo);
  const newUsersRow = await db.prepare(
    'SELECT COUNT(*) as count FROM users WHERE created_at >= ?'
  ).get(windowStartTime);

  // 2. Groups
  const totalGroupsRow = await db.prepare(
    'SELECT COUNT(*) as count FROM groups WHERE deleted_at IS NULL'
  ).get();

  // 3. Personal Expenses
  const personalExpRow = await db.prepare(
    'SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total_volume FROM personal_expenses'
  ).get();

  // 4. Group Expenses
  const groupExpRow = await db.prepare(
    'SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total_volume FROM group_expenses'
  ).get();

  // 5. Bills
  const personalBillsRow = await db.prepare('SELECT COUNT(*) as count FROM personal_bills').get();
  const groupBillsRow = await db.prepare('SELECT COUNT(*) as count FROM group_bills').get();

  // 6. Settlements
  const settlementsRow = await db.prepare(`
    SELECT 
      COUNT(*) as count,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
      COALESCE(SUM(amount), 0) as total_volume,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END), 0) as completed_volume
    FROM settlements
  `).get();

  // 7. User Growth Trend (Daily aggregated registrations)
  const usersInWindow = await db.prepare(`
    SELECT created_at FROM users 
    WHERE created_at >= ?
    ORDER BY created_at ASC
  `).all(windowStartTime);

  // Bucket users by date
  const growthMap = new Map();
  const dayCount = Math.min(Math.ceil(timeWindowMs / (24 * 60 * 60 * 1000)), 90);
  for (let i = dayCount - 1; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().split('T')[0];
    growthMap.set(key, 0);
  }

  usersInWindow.forEach((u) => {
    const key = new Date(Number(u.created_at)).toISOString().split('T')[0];
    if (growthMap.has(key)) {
      growthMap.set(key, growthMap.get(key) + 1);
    }
  });

  const userGrowth = Array.from(growthMap.entries()).map(([date, count]) => ({
    date,
    count
  }));

  // 8. Recent Activity Timeline
  const recentUsers = await db.prepare(`
    SELECT id, username, email, created_at, 'user_registered' as type 
    FROM users ORDER BY created_at DESC LIMIT 5
  `).all();

  const recentGroups = await db.prepare(`
    SELECT id, name, created_at, 'group_created' as type 
    FROM groups WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 5
  `).all();

  const recentBills = await db.prepare(`
    SELECT id, cycle_number, total_spent, created_at, 'personal_bill_generated' as type 
    FROM personal_bills ORDER BY created_at DESC LIMIT 5
  `).all();

  const recentSettlements = await db.prepare(`
    SELECT s.id, s.amount, s.status, s.created_at, g.name as group_name, 'settlement_event' as type
    FROM settlements s JOIN groups g ON s.group_id = g.id
    ORDER BY s.created_at DESC LIMIT 5
  `).all();

  const recentAudit = await db.prepare(`
    SELECT id, admin_username, action, target_type, target_id, created_at, 'admin_action' as type
    FROM admin_audit_logs ORDER BY created_at DESC LIMIT 5
  `).all();

  const unifiedActivity = [
    ...recentUsers.map(u => ({
      id: u.id,
      type: 'user_registration',
      title: `New User Registered: @${u.username}`,
      timestamp: Number(u.created_at),
      metadata: { email: u.email }
    })),
    ...recentGroups.map(g => ({
      id: g.id,
      type: 'group_created',
      title: `Group Created: "${g.name}"`,
      timestamp: Number(g.created_at),
      metadata: {}
    })),
    ...recentBills.map(b => ({
      id: b.id,
      type: 'bill_generated',
      title: `Personal Bill Generated for Cycle #${b.cycle_number}`,
      timestamp: Number(b.created_at),
      metadata: { amount: Number(b.total_spent) }
    })),
    ...recentSettlements.map(s => ({
      id: s.id,
      type: 'settlement',
      title: `Settlement in ${s.group_name} (${s.status})`,
      timestamp: Number(s.created_at),
      metadata: { amount: Number(s.amount), status: s.status }
    })),
    ...recentAudit.map(a => ({
      id: a.id,
      type: 'admin_audit',
      title: `Admin @${a.admin_username} performed ${a.action}`,
      timestamp: Number(a.created_at),
      metadata: { targetType: a.target_type, targetId: a.target_id }
    }))
  ];

  unifiedActivity.sort((a, b) => b.timestamp - a.timestamp);
  const recentActivity = unifiedActivity.slice(0, 15);

  return {
    kpis: {
      totalUsers: Number(totalUsersRow?.count || 0),
      activeUsers: Number(activeUsersRow?.count || 0),
      newUsers: Number(newUsersRow?.count || 0),
      totalGroups: Number(totalGroupsRow?.count || 0),
      personalExpensesCount: Number(personalExpRow?.count || 0),
      personalExpensesVolume: Number(personalExpRow?.total_volume || 0),
      groupExpensesCount: Number(groupExpRow?.count || 0),
      groupExpensesVolume: Number(groupExpRow?.total_volume || 0),
      totalBills: Number((personalBillsRow?.count || 0) + (groupBillsRow?.count || 0)),
      personalBillsCount: Number(personalBillsRow?.count || 0),
      groupBillsCount: Number(groupBillsRow?.count || 0),
      totalSettlements: Number(settlementsRow?.count || 0),
      completedSettlements: Number(settlementsRow?.completed_count || 0),
      totalSettlementVolume: Number(settlementsRow?.total_volume || 0),
      completedSettlementVolume: Number(settlementsRow?.completed_volume || 0)
    },
    userGrowth,
    recentActivity
  };
}

/**
 * Get Server-Side Paginated Users List with Filters and Search
 */
async function getUsersList({
  page = 1,
  limit = 20,
  search = '',
  status = 'all',
  sortBy = 'created_at',
  sortOrder = 'desc'
} = {}) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (p - 1) * l;

  const now = Date.now();
  const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);

  let whereClauses = [];
  let params = [];

  // Search filter (id, username, email)
  if (search && search.trim()) {
    const term = `%${search.trim().toLowerCase()}%`;
    whereClauses.push('(LOWER(u.username) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(u.id) LIKE ?)');
    params.push(term, term, term);
  }

  // Status filter
  if (status === 'active') {
    whereClauses.push(`EXISTS (SELECT 1 FROM user_sessions us WHERE us.user_id = u.id AND us.last_active_at >= ?)`);
    params.push(thirtyDaysAgo);
  } else if (status === 'inactive') {
    whereClauses.push(`NOT EXISTS (SELECT 1 FROM user_sessions us WHERE us.user_id = u.id AND us.last_active_at >= ?)`);
    params.push(thirtyDaysAgo);
  } else if (status === 'recently_registered') {
    whereClauses.push('u.created_at >= ?');
    params.push(sevenDaysAgo);
  } else if (status === 'admin') {
    whereClauses.push('u.is_admin = TRUE');
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // Count total records
  const countSql = `SELECT COUNT(*) as total FROM users u ${whereSql}`;
  const totalRow = await db.prepare(countSql).get(...params);
  const total = Number(totalRow?.total || 0);

  // Sorting
  let orderColumn = 'u.created_at';
  if (sortBy === 'username') orderColumn = 'u.username';
  else if (sortBy === 'email') orderColumn = 'u.email';
  else if (sortBy === 'last_active') orderColumn = 'last_active_at';

  const orderDirection = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const querySql = `
    SELECT 
      u.id,
      u.email,
      u.username,
      u.display_name,
      u.avatar_url,
      u.is_admin,
      u.created_at,
      (SELECT MAX(last_active_at) FROM user_sessions WHERE user_id = u.id) as last_active_at,
      (SELECT COUNT(*) FROM group_members WHERE user_id = u.id AND status = 'active') as groups_count,
      (
        (SELECT COUNT(*) FROM personal_expenses WHERE user_id = u.id) +
        (SELECT COUNT(*) FROM group_expenses WHERE user_id = u.id)
      ) as expenses_count
    FROM users u
    ${whereSql}
    ORDER BY ${orderColumn} ${orderDirection}
    LIMIT ? OFFSET ?
  `;

  const queryParams = [...params, l, offset];
  const rows = await db.prepare(querySql).all(...queryParams);

  const users = rows.map((u) => {
    const lastActive = u.last_active_at ? Number(u.last_active_at) : null;
    const isActive = lastActive && lastActive >= thirtyDaysAgo;
    return {
      id: u.id,
      email: u.email,
      username: u.username,
      displayName: u.display_name || u.username,
      avatarUrl: u.avatar_url,
      isAdmin: Boolean(u.is_admin || (config.ADMIN_EMAILS && config.ADMIN_EMAILS.includes(u.email.toLowerCase()))),
      createdAt: Number(u.created_at),
      lastActiveAt: lastActive,
      status: isActive ? 'active' : 'inactive',
      groupsCount: Number(u.groups_count || 0),
      expensesCount: Number(u.expenses_count || 0)
    };
  });

  return {
    users,
    pagination: {
      page: p,
      limit: l,
      total,
      totalPages: Math.ceil(total / l)
    }
  };
}

/**
 * Get Comprehensive User Details
 */
async function getUserDetails(userId) {
  if (!userId) throw new Error('User ID is required.');

  const user = await db.prepare(`
    SELECT id, email, username, display_name, bio, avatar_url, is_admin, last_username_change, created_at, updated_at
    FROM users WHERE id = ?
  `).get(userId);

  if (!user) {
    throw new Error('User not found.');
  }

  const personalSpentRow = await db.prepare(
    'SELECT COALESCE(SUM(amount), 0) as total FROM personal_expenses WHERE user_id = ?'
  ).get(userId);

  const groupSpentRow = await db.prepare(
    'SELECT COALESCE(SUM(amount), 0) as total FROM group_expenses WHERE user_id = ?'
  ).get(userId);

  const groupsCountRow = await db.prepare(
    "SELECT COUNT(*) as count FROM group_members WHERE user_id = ? AND status = 'active'"
  ).get(userId);

  const personalBillsCountRow = await db.prepare(
    'SELECT COUNT(*) as count FROM personal_bills WHERE user_id = ?'
  ).get(userId);

  const settlementsCountRow = await db.prepare(
    'SELECT COUNT(*) as count FROM settlements WHERE payer_id = ? OR receiver_id = ?'
  ).get(userId, userId);

  const sessionsCountRow = await db.prepare(
    'SELECT COUNT(*) as count FROM user_sessions WHERE user_id = ?'
  ).get(userId);

  const lastActiveRow = await db.prepare(
    'SELECT MAX(last_active_at) as last_active FROM user_sessions WHERE user_id = ?'
  ).get(userId);

  return {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.display_name || user.username,
      bio: user.bio || '',
      avatarUrl: user.avatar_url,
      isAdmin: Boolean(user.is_admin || (config.ADMIN_EMAILS && config.ADMIN_EMAILS.includes(user.email.toLowerCase()))),
      lastUsernameChange: user.last_username_change ? Number(user.last_username_change) : null,
      createdAt: Number(user.created_at),
      updatedAt: Number(user.updated_at),
      lastActiveAt: lastActiveRow?.last_active ? Number(lastActiveRow.last_active) : null
    },
    metrics: {
      personalSpentPaise: Number(personalSpentRow?.total || 0),
      groupSpentPaise: Number(groupSpentRow?.total || 0),
      totalSpentPaise: Number((personalSpentRow?.total || 0) + (groupSpentRow?.total || 0)),
      groupsCount: Number(groupsCountRow?.count || 0),
      personalBillsCount: Number(personalBillsCountRow?.count || 0),
      settlementsCount: Number(settlementsCountRow?.count || 0),
      sessionsCount: Number(sessionsCountRow?.count || 0)
    }
  };
}

/**
 * Get User's Personal and Group Expenses
 */
async function getUserExpenses(userId, { limit = 50, page = 1 } = {}) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const offset = (p - 1) * l;

  // Personal expenses
  const personalExpenses = await db.prepare(`
    SELECT 
      pe.id, pe.description, pe.amount, pe.created_at,
      peh.name as head_name,
      pc.cycle_number
    FROM personal_expenses pe
    LEFT JOIN personal_expense_heads peh ON pe.head_id = peh.id
    LEFT JOIN personal_cycles pc ON pe.cycle_id = pc.id
    WHERE pe.user_id = ?
    ORDER BY pe.created_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, l, offset);

  // Group expenses
  const groupExpenses = await db.prepare(`
    SELECT 
      ge.id, ge.description, ge.amount, ge.created_at,
      g.name as group_name,
      gc.cycle_number
    FROM group_expenses ge
    LEFT JOIN groups g ON ge.group_id = g.id
    LEFT JOIN group_cycles gc ON ge.cycle_id = gc.id
    WHERE ge.user_id = ?
    ORDER BY ge.created_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, l, offset);

  return {
    personal: personalExpenses.map(e => ({
      id: e.id,
      description: e.description,
      amountPaise: Number(e.amount),
      headName: e.head_name || 'General',
      cycleNumber: e.cycle_number || 1,
      createdAt: Number(e.created_at)
    })),
    group: groupExpenses.map(e => ({
      id: e.id,
      description: e.description,
      amountPaise: Number(e.amount),
      groupName: e.group_name || 'Group',
      cycleNumber: e.cycle_number || 1,
      createdAt: Number(e.created_at)
    }))
  };
}

/**
 * Get User's Groups
 */
async function getUserGroups(userId) {
  const groups = await db.prepare(`
    SELECT 
      g.id, g.name, g.created_at as group_created_at,
      gm.role, gm.temporary_name, gm.joined_at, gm.status as member_status,
      (SELECT COUNT(*) FROM group_members WHERE group_id = g.id AND status = 'active') as member_count,
      (SELECT cycle_number FROM group_cycles WHERE group_id = g.id AND status = 'active' LIMIT 1) as current_cycle_number,
      (SELECT status FROM group_cycles WHERE group_id = g.id AND status = 'active' LIMIT 1) as current_cycle_status,
      (
        SELECT COALESCE(SUM(ge.amount), 0)
        FROM group_expenses ge
        JOIN group_cycles gc ON ge.cycle_id = gc.id
        WHERE ge.group_id = g.id AND gc.status = 'active'
      ) as active_cycle_spent
    FROM group_members gm
    JOIN groups g ON gm.group_id = g.id
    WHERE gm.user_id = ? AND g.deleted_at IS NULL
    ORDER BY gm.joined_at DESC
  `).all(userId);

  return groups.map(g => ({
    groupId: g.id,
    groupName: g.name,
    role: g.role,
    temporaryName: g.temporary_name,
    memberStatus: g.member_status,
    joinedAt: Number(g.joined_at),
    groupCreatedAt: Number(g.group_created_at),
    memberCount: Number(g.member_count || 0),
    currentCycleNumber: g.current_cycle_number ? Number(g.current_cycle_number) : 1,
    currentCycleStatus: g.current_cycle_status || 'active',
    activeCycleSpentPaise: Number(g.active_cycle_spent || 0)
  }));
}

/**
 * Get User's Permanent Bills
 */
async function getUserBills(userId) {
  const personalBills = await db.prepare(`
    SELECT id, cycle_number, total_set_amount, total_spent, total_remaining, total_overspent, entry_count, created_at
    FROM personal_bills
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId);

  const groupBills = await db.prepare(`
    SELECT gb.id, gb.group_id, gb.group_name, gb.cycle_number, gb.total_spent, gb.member_count, gb.equal_share, gb.created_at
    FROM group_bills gb
    JOIN group_members gm ON gb.group_id = gm.group_id
    WHERE gm.user_id = ?
    ORDER BY gb.created_at DESC
  `).all(userId);

  return {
    personalBills: personalBills.map(b => ({
      id: b.id,
      cycleNumber: Number(b.cycle_number),
      totalSetAmountPaise: Number(b.total_set_amount),
      totalSpentPaise: Number(b.total_spent),
      totalRemainingPaise: Number(b.total_remaining),
      totalOverspentPaise: Number(b.total_overspent),
      entryCount: Number(b.entry_count),
      createdAt: Number(b.created_at)
    })),
    groupBills: groupBills.map(b => ({
      id: b.id,
      groupId: b.group_id,
      groupName: b.group_name,
      cycleNumber: Number(b.cycle_number),
      totalSpentPaise: Number(b.total_spent),
      memberCount: Number(b.member_count),
      equalSharePaise: Number(b.equal_share),
      createdAt: Number(b.created_at)
    }))
  };
}

/**
 * Get User's Settlements
 */
async function getUserSettlements(userId) {
  const rows = await db.prepare(`
    SELECT 
      s.id, s.bill_id, s.amount, s.status, s.paid_at, s.confirmed_at, s.created_at,
      g.name as group_name,
      u1.id as payer_id, u1.username as payer_username, u1.display_name as payer_name,
      u2.id as receiver_id, u2.username as receiver_username, u2.display_name as receiver_name
    FROM settlements s
    JOIN groups g ON s.group_id = g.id
    JOIN users u1 ON s.payer_id = u1.id
    JOIN users u2 ON s.receiver_id = u2.id
    WHERE s.payer_id = ? OR s.receiver_id = ?
    ORDER BY s.created_at DESC
  `).all(userId, userId);

  return rows.map(s => ({
    id: s.id,
    billId: s.bill_id,
    groupName: s.group_name,
    amountPaise: Number(s.amount),
    status: s.status,
    isPayer: s.payer_id === userId,
    isReceiver: s.receiver_id === userId,
    payer: {
      id: s.payer_id,
      username: s.payer_username,
      name: s.payer_name || s.payer_username
    },
    receiver: {
      id: s.receiver_id,
      username: s.receiver_username,
      name: s.receiver_name || s.receiver_username
    },
    paidAt: s.paid_at ? Number(s.paid_at) : null,
    confirmedAt: s.confirmed_at ? Number(s.confirmed_at) : null,
    createdAt: Number(s.created_at)
  }));
}

/**
 * Get User's Active Multi-Device Sessions
 * SECURITY: Never returns token or JWT secrets
 */
async function getUserSessions(userId) {
  const rows = await db.prepare(`
    SELECT id, device_info, created_at, last_active_at
    FROM user_sessions
    WHERE user_id = ?
    ORDER BY last_active_at DESC
  `).all(userId);

  const now = Date.now();
  const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

  return rows.map(s => ({
    id: s.id,
    deviceInfo: s.device_info || 'Unknown Device',
    createdAt: Number(s.created_at),
    lastActiveAt: Number(s.last_active_at),
    isRecent: Number(s.last_active_at) >= thirtyDaysAgo
  }));
}

/**
 * Revoke specific user session (Admin action)
 */
async function revokeUserSession(userId, sessionId, adminUser, ipAddress = null) {
  if (!sessionId) throw new Error('Session ID is required.');

  const session = await db.prepare(
    'SELECT id, user_id, device_info FROM user_sessions WHERE id = ? AND user_id = ?'
  ).get(sessionId, userId);

  if (!session) {
    throw new Error('Session not found or already revoked.');
  }

  await db.prepare('DELETE FROM user_sessions WHERE id = ?').run(sessionId);

  await logAudit({
    adminId: adminUser.id,
    adminUsername: adminUser.username,
    action: 'revoke_session',
    targetType: 'user_session',
    targetId: sessionId,
    details: { targetUserId: userId, deviceInfo: session.device_info },
    ipAddress,
    status: 'success'
  });

  return { success: true, message: 'Session revoked successfully.' };
}

/**
 * Get Paginated Audit Logs
 */
async function getAuditLogs({ page = 1, limit = 50, action = '', search = '' } = {}) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const offset = (p - 1) * l;

  let whereClauses = [];
  let params = [];

  if (action && action.trim()) {
    whereClauses.push('action = ?');
    params.push(action.trim());
  }

  if (search && search.trim()) {
    const term = `%${search.trim().toLowerCase()}%`;
    whereClauses.push('(LOWER(admin_username) LIKE ? OR LOWER(target_id) LIKE ? OR LOWER(details_json) LIKE ?)');
    params.push(term, term, term);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const totalRow = await db.prepare(`SELECT COUNT(*) as total FROM admin_audit_logs ${whereSql}`).get(...params);
  const total = Number(totalRow?.total || 0);

  const logs = await db.prepare(`
    SELECT id, admin_id, admin_username, action, target_type, target_id, details_json, ip_address, status, created_at
    FROM admin_audit_logs
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, l, offset);

  return {
    logs: logs.map(log => ({
      id: log.id,
      adminId: log.admin_id,
      adminUsername: log.admin_username,
      action: log.action,
      targetType: log.target_type,
      targetId: log.target_id,
      details: log.details_json ? JSON.parse(log.details_json) : null,
      ipAddress: log.ip_address,
      status: log.status,
      createdAt: Number(log.created_at)
    })),
    pagination: {
      page: p,
      limit: l,
      total,
      totalPages: Math.ceil(total / l)
    }
  };
}

/**
 * Get Comprehensive System Health Status
 */
async function getSystemHealth() {
  const startTime = Date.now();
  let dbStatus = 'disconnected';
  let dbLatencyMs = null;
  let dbEngine = db.isPostgres ? 'PostgreSQL (Neon)' : 'SQLite (WAL Mode)';

  try {
    await db.prepare('SELECT 1 as ping').get();
    dbLatencyMs = Date.now() - startTime;
    dbStatus = 'connected';
  } catch (err) {
    dbStatus = 'error: ' + err.message;
  }

  const websocketService = require('./websocketService');
  let wsStatus = 'operational';
  let wsConnectedCount = 0;
  if (websocketService && typeof websocketService.getStats === 'function') {
    const stats = websocketService.getStats();
    wsStatus = stats.status;
    wsConnectedCount = stats.clientCount;
  }

  const memory = process.memoryUsage();

  return {
    application: {
      name: 'Spendly',
      status: 'operational',
      environment: process.env.NODE_ENV || 'development',
      nodeVersion: process.version,
      uptimeSeconds: Math.floor(process.uptime()),
      memory: {
        rssMb: Math.round(memory.rss / (1024 * 1024)),
        heapTotalMb: Math.round(memory.heapTotal / (1024 * 1024)),
        heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024))
      }
    },
    database: {
      status: dbStatus,
      engine: dbEngine,
      latencyMs: dbLatencyMs
    },
    websocket: {
      status: wsStatus,
      connectedClients: wsConnectedCount
    },
    emailService: {
      provider: 'Brevo SMTP Relay',
      configured: Boolean(config.SMTP_USER && config.SMTP_PASS),
      host: config.SMTP_HOST,
      port: config.SMTP_PORT
    },
    pushService: {
      configured: Boolean(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY)
    },
    timestamp: Date.now()
  };
}

module.exports = {
  isAdmin,
  logAudit,
  adminLogin,
  getDashboardMetrics,
  getUsersList,
  getUserDetails,
  getUserExpenses,
  getUserGroups,
  getUserBills,
  getUserSettlements,
  getUserSessions,
  revokeUserSession,
  getAuditLogs,
  getSystemHealth
};
