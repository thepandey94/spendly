/**
 * Spendly Admin Dashboard View
 * Comprehensive usage analytics, KPIs, user growth trends, and real-time activity feed.
 */
const SpendlyAdminDashboardView = {
  timeRange: '30d',

  async render() {
    const loadingHtml = `
      <div style="text-align: center; padding: 60px 20px; color: var(--text-muted);">
        <div class="logo-icon" style="margin: 0 auto 16px auto; animation: pulse 1.5s infinite;"></div>
        <p style="font-size: 15px; font-weight: 500;">Aggregating platform metrics from database...</p>
      </div>
    `;

    SpendlyAdmin.renderShell('dashboard', loadingHtml);

    try {
      const data = await SpendlyAdmin.request(`/dashboard?timeRange=${this.timeRange}`);
      this.renderContent(data);
    } catch (err) {
      const errorHtml = `
        <div class="empty-state" style="padding: 40px; text-align: center;">
          <h3 style="color: var(--accent-danger); margin-bottom: 8px;">Failed to load dashboard metrics</h3>
          <p style="color: var(--text-secondary); margin-bottom: 20px;">${err.message}</p>
          <button class="btn btn-primary" onclick="SpendlyAdminDashboardView.render()">Retry</button>
        </div>
      `;
      SpendlyAdmin.renderShell('dashboard', errorHtml);
    }
  },

  renderContent(data) {
    const { kpis, userGrowth, recentActivity } = data;

    // Calculate max count for growth chart scaling
    const maxGrowth = Math.max(...userGrowth.map(g => g.count), 1);

    const contentHtml = `
      <div class="admin-header">
        <div>
          <h1 class="admin-title">Platform Overview</h1>
          <p class="admin-subtitle">Live database analytics and system-wide usage metrics</p>
        </div>
        <div style="display: flex; gap: 10px; align-items: center;">
          <select id="admin-time-range" class="admin-select">
            <option value="7d" ${this.timeRange === '7d' ? 'selected' : ''}>Last 7 Days</option>
            <option value="30d" ${this.timeRange === '30d' ? 'selected' : ''}>Last 30 Days</option>
            <option value="90d" ${this.timeRange === '90d' ? 'selected' : ''}>Last 90 Days</option>
            <option value="this_year" ${this.timeRange === 'this_year' ? 'selected' : ''}>Past 1 Year</option>
          </select>
          <button class="btn btn-secondary" id="admin-refresh-dashboard-btn" style="padding: 9px 14px; font-size: 13px;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Refresh
          </button>
        </div>
      </div>

      <!-- KPI Metrics Grid -->
      <div class="admin-kpi-grid">
        <div class="admin-kpi-card">
          <div class="admin-kpi-label">
            <span>Total Registered Users</span>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div class="admin-kpi-value">${kpis.totalUsers}</div>
          <div class="admin-kpi-sub">${kpis.newUsers} new in selected window</div>
        </div>

        <div class="admin-kpi-card navy">
          <div class="admin-kpi-label">
            <span>Active Users (30d)</span>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div class="admin-kpi-value">${kpis.activeUsers}</div>
          <div class="admin-kpi-sub">${Math.round((kpis.activeUsers / (kpis.totalUsers || 1)) * 100)}% monthly engagement</div>
        </div>

        <div class="admin-kpi-card sky">
          <div class="admin-kpi-label">
            <span>Active Groups</span>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div class="admin-kpi-value">${kpis.totalGroups}</div>
          <div class="admin-kpi-sub">Collaborative split groups</div>
        </div>

        <div class="admin-kpi-card success">
          <div class="admin-kpi-label">
            <span>Personal Expenses</span>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div class="admin-kpi-value">${SpendlyStore.formatINR(kpis.personalExpensesVolume)}</div>
          <div class="admin-kpi-sub">${kpis.personalExpensesCount} individual recorded entries</div>
        </div>

        <div class="admin-kpi-card success">
          <div class="admin-kpi-label">
            <span>Group Expenses</span>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div class="admin-kpi-value">${SpendlyStore.formatINR(kpis.groupExpensesVolume)}</div>
          <div class="admin-kpi-sub">${kpis.groupExpensesCount} split expense entries</div>
        </div>

        <div class="admin-kpi-card warning">
          <div class="admin-kpi-label">
            <span>Permanent Bills</span>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div class="admin-kpi-value">${kpis.totalBills}</div>
          <div class="admin-kpi-sub">${kpis.personalBillsCount} personal &bull; ${kpis.groupBillsCount} group</div>
        </div>

        <div class="admin-kpi-card success">
          <div class="admin-kpi-label">
            <span>Settled Debt Volume</span>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div class="admin-kpi-value">${SpendlyStore.formatINR(kpis.completedSettlementVolume)}</div>
          <div class="admin-kpi-sub">${kpis.completedSettlements} of ${kpis.totalSettlements} settlements confirmed</div>
        </div>
      </div>

      <!-- Growth Chart & Recent Activity Split -->
      <div class="admin-dashboard-split">
        <!-- Left: User Registration Growth -->
        <div class="admin-panel">
          <div class="admin-panel-header">
            <h3 class="admin-panel-title">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              User Registration Velocity (${userGrowth.length} Days)
            </h3>
            <span style="font-size: 12px; font-weight: 600; color: var(--accent-primary);">
              Total ${kpis.newUsers} registrations
            </span>
          </div>
          <div class="admin-panel-body">
            <div class="admin-growth-container">
              ${userGrowth.map(g => {
                const heightPct = Math.max(4, Math.round((g.count / maxGrowth) * 100));
                const shortDate = g.date.split('-').slice(1).join('/');
                return `
                  <div class="admin-growth-col" title="${g.date}: ${g.count} new users">
                    <div class="admin-growth-bar" style="height: ${heightPct}%;"></div>
                    <div class="admin-growth-date">${shortDate}</div>
                  </div>
                `;
              }).join('')}
            </div>
            <div style="display: flex; justify-content: space-between; margin-top: 14px; font-size: 12px; color: var(--text-muted);">
              <span>Start: ${userGrowth[0]?.date || 'N/A'}</span>
              <span>Daily Registration Frequency</span>
              <span>Today: ${userGrowth[userGrowth.length - 1]?.date || 'N/A'}</span>
            </div>
          </div>
        </div>

        <!-- Right: Recent Platform Activity -->
        <div class="admin-panel">
          <div class="admin-panel-header">
            <h3 class="admin-panel-title">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Recent Platform Events
            </h3>
            <a href="#/admin/audit" style="font-size: 12px; font-weight: 600; color: var(--accent-primary); text-decoration: none;">
              Audit Logs &rarr;
            </a>
          </div>
          <div class="admin-panel-body">
            <div class="admin-activity-list">
              ${recentActivity.length === 0 ? `
                <div style="text-align: center; padding: 30px; color: var(--text-muted); font-size: 13px;">
                  No recent activity recorded yet.
                </div>
              ` : recentActivity.map(act => {
                let iconClass = 'user';
                let iconSvg = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
                
                if (act.type === 'group_created') {
                  iconClass = 'group';
                  iconSvg = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0" stroke="currentColor" stroke-width="2"/></svg>';
                } else if (act.type === 'bill_generated') {
                  iconClass = 'bill';
                  iconSvg = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" stroke="currentColor" stroke-width="2"/></svg>';
                } else if (act.type === 'settlement') {
                  iconClass = 'settle';
                  iconSvg = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="2"/></svg>';
                } else if (act.type === 'admin_audit') {
                  iconClass = 'audit';
                  iconSvg = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke="currentColor" stroke-width="2"/></svg>';
                }

                return `
                  <div class="admin-activity-item">
                    <div class="admin-activity-icon ${iconClass}">
                      ${iconSvg}
                    </div>
                    <div class="admin-activity-content">
                      <div class="admin-activity-title">${SpendlyApp.escapeHtml(act.title)}</div>
                      <div class="admin-activity-time">${SpendlyStore.formatDateTime(act.timestamp)}</div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    SpendlyAdmin.renderShell('dashboard', contentHtml);

    // Event attachments
    const rangeSelect = document.getElementById('admin-time-range');
    if (rangeSelect) {
      rangeSelect.onchange = (e) => {
        this.timeRange = e.target.value;
        this.render();
      };
    }

    const refreshBtn = document.getElementById('admin-refresh-dashboard-btn');
    if (refreshBtn) {
      refreshBtn.onclick = () => {
        this.render();
      };
    }
  }
};

window.SpendlyAdminDashboardView = SpendlyAdminDashboardView;
