const express = require('express');
const router = express.Router();
const { authenticateAdmin } = require('../middleware/adminAuth');
const adminService = require('../services/adminService');
const db = require('../db/database');

/**
 * 1. Admin Authentication: Login
 */
router.post('/auth/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'Admin Browser';

    const result = await adminService.adminLogin({
      identifier,
      password,
      ipAddress,
      userAgent
    });

    res.json(result);
  } catch (err) {
    const status = err.message.includes('Access denied') ? 403 : 401;
    res.status(status).json({ error: err.message });
  }
});

/**
 * 2. Admin Authentication: Verify current admin session
 */
router.get('/auth/me', authenticateAdmin, (req, res) => {
  res.json({
    user: req.adminUser,
    isAdmin: true
  });
});

/**
 * 3. Admin Authentication: Logout
 */
router.post('/auth/logout', authenticateAdmin, async (req, res) => {
  try {
    if (req.token) {
      await db.prepare('DELETE FROM user_sessions WHERE token = ?').run(req.token);
    }
    await adminService.logAudit({
      adminId: req.adminUser.id,
      adminUsername: req.adminUser.username,
      action: 'admin_logout',
      targetType: 'session',
      targetId: req.adminUser.id,
      ipAddress: req.ip || req.headers['x-forwarded-for'],
      status: 'success'
    });
    res.json({ success: true, message: 'Admin logged out successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 4. Overall Admin Dashboard Metrics
 */
router.get('/dashboard', authenticateAdmin, async (req, res) => {
  try {
    const timeRange = req.query.timeRange || '30d';
    const metrics = await adminService.getDashboardMetrics({ timeRange });
    res.json(metrics);
  } catch (err) {
    console.error('[Admin Dashboard Error]', err);
    res.status(500).json({ error: 'Failed to retrieve dashboard metrics.' });
  }
});

/**
 * 5. Users List (Server-side paginated & searchable)
 */
router.get('/users', authenticateAdmin, async (req, res) => {
  try {
    const { page, limit, search, status, sortBy, sortOrder } = req.query;
    const result = await adminService.getUsersList({
      page,
      limit,
      search,
      status,
      sortBy,
      sortOrder
    });
    res.json(result);
  } catch (err) {
    console.error('[Admin Users List Error]', err);
    res.status(500).json({ error: 'Failed to retrieve users.' });
  }
});

/**
 * 6. User Details by ID
 */
router.get('/users/:id', authenticateAdmin, async (req, res) => {
  try {
    const details = await adminService.getUserDetails(req.params.id);
    
    // Log audit view
    await adminService.logAudit({
      adminId: req.adminUser.id,
      adminUsername: req.adminUser.username,
      action: 'view_user_details',
      targetType: 'user',
      targetId: req.params.id,
      ipAddress: req.ip || req.headers['x-forwarded-for']
    });

    res.json(details);
  } catch (err) {
    const status = err.message === 'User not found.' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

/**
 * 7. User's Personal & Group Expenses
 */
router.get('/users/:id/expenses', authenticateAdmin, async (req, res) => {
  try {
    const { page, limit } = req.query;
    const expenses = await adminService.getUserExpenses(req.params.id, { page, limit });
    res.json(expenses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 8. User's Groups
 */
router.get('/users/:id/groups', authenticateAdmin, async (req, res) => {
  try {
    const groups = await adminService.getUserGroups(req.params.id);
    res.json({ groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 9. User's Bills
 */
router.get('/users/:id/bills', authenticateAdmin, async (req, res) => {
  try {
    const bills = await adminService.getUserBills(req.params.id);
    res.json(bills);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 10. User's Settlements
 */
router.get('/users/:id/settlements', authenticateAdmin, async (req, res) => {
  try {
    const settlements = await adminService.getUserSettlements(req.params.id);
    res.json({ settlements });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 11. User's Active Sessions
 */
router.get('/users/:id/sessions', authenticateAdmin, async (req, res) => {
  try {
    const sessions = await adminService.getUserSessions(req.params.id);
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 12. Revoke a User's Session
 */
router.post('/users/:id/sessions/:sessionId/revoke', authenticateAdmin, async (req, res) => {
  try {
    const ipAddress = req.ip || req.headers['x-forwarded-for'];
    const result = await adminService.revokeUserSession(
      req.params.id,
      req.params.sessionId,
      req.adminUser,
      ipAddress
    );
    res.json(result);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

/**
 * 13. Administrative Audit Logs
 */
router.get('/audit-logs', authenticateAdmin, async (req, res) => {
  try {
    const { page, limit, action, search } = req.query;
    const result = await adminService.getAuditLogs({ page, limit, action, search });
    res.json(result);
  } catch (err) {
    console.error('[Admin Audit Logs Error]', err);
    res.status(500).json({ error: 'Failed to retrieve audit logs.' });
  }
});

/**
 * 14. System Health Status
 */
router.get('/system/health', authenticateAdmin, async (req, res) => {
  try {
    const health = await adminService.getSystemHealth();
    res.json(health);
  } catch (err) {
    console.error('[Admin System Health Error]', err);
    res.status(500).json({ error: 'Failed to inspect system health.' });
  }
});

module.exports = router;
