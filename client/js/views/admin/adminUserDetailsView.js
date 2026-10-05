/**
 * Spendly Admin User Details View
 * Deep-dive inspection of user account, personal & group expenses, groups, immutable bills, settlements, and sessions.
 */
const SpendlyAdminUserDetailsView = {
  userId: null,
  activeTab: 'account', // 'account' | 'expenses' | 'groups' | 'bills' | 'settlements' | 'sessions'
  userData: null,

  async render(userId) {
    if (!userId) {
      window.location.hash = '#/admin/users';
      return;
    }
    this.userId = userId;

    const loadingHtml = `
      <div style="text-align: center; padding: 60px 20px; color: var(--text-muted);">
        <div class="logo-icon" style="margin: 0 auto 16px auto; animation: pulse 1.5s infinite;"></div>
        <p style="font-size: 15px; font-weight: 500;">Loading user profile & associated records...</p>
      </div>
    `;

    SpendlyAdmin.renderShell('users', loadingHtml);

    try {
      this.userData = await SpendlyAdmin.request(`/users/${userId}`);
      this.renderFullView();
    } catch (err) {
      const errorHtml = `
        <div class="empty-state" style="padding: 40px; text-align: center;">
          <h3 style="color: var(--accent-danger); margin-bottom: 8px;">User not found</h3>
          <p style="color: var(--text-secondary); margin-bottom: 20px;">${err.message}</p>
          <a href="#/admin/users" class="btn btn-secondary">&larr; Back to Users Directory</a>
        </div>
      `;
      SpendlyAdmin.renderShell('users', errorHtml);
    }
  },

  renderFullView() {
    const { user, metrics } = this.userData;
    const avatarLetter = (user.displayName || user.username || 'U')[0].toUpperCase();

    const contentHtml = `
      <div style="margin-bottom: 20px;">
        <a href="#/admin/users" style="font-size: 13px; font-weight: 600; color: var(--accent-primary); text-decoration: none; display: inline-flex; align-items: center; gap: 6px;">
          <span>&larr;</span> Back to Users Directory
        </a>
      </div>

      <!-- Hero Header Card -->
      <div class="admin-user-hero">
        ${user.avatarUrl ? `
          <img src="${user.avatarUrl}" class="admin-hero-avatar" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
          <div class="admin-hero-avatar" style="display: none;">${avatarLetter}</div>
        ` : `
          <div class="admin-hero-avatar">${avatarLetter}</div>
        `}

        <div class="admin-hero-details">
          <div class="admin-hero-name">
            <span>${SpendlyApp.escapeHtml(user.displayName)}</span>
            ${user.isAdmin ? '<span class="admin-badge">Admin</span>' : ''}
          </div>
          <div style="font-size: 14px; color: var(--text-muted); margin-bottom: 8px;">
            @${SpendlyApp.escapeHtml(user.username)} &bull; ${SpendlyApp.escapeHtml(user.email)}
          </div>
          <div class="admin-hero-meta">
            <div>
              User ID: 
              <span class="admin-copy-id" id="copy-user-id-btn" title="Click to copy ID">
                ${user.id.slice(0, 16)}...
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none"><path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
            </div>
            <div>Joined: <strong>${SpendlyStore.formatDateTime(user.createdAt)}</strong></div>
            <div>Last Active: <strong>${user.lastActiveAt ? SpendlyStore.formatDateTime(user.lastActiveAt) : 'Never'}</strong></div>
          </div>
        </div>
      </div>

      <!-- Quick Metrics Strip -->
      <div class="admin-kpi-grid" style="margin-bottom: 24px;">
        <div class="admin-kpi-card success" style="padding: 14px 18px;">
          <div class="admin-kpi-label">Personal Spending</div>
          <div class="admin-kpi-value" style="font-size: 20px;">${SpendlyStore.formatINR(metrics.personalSpentPaise)}</div>
          <div class="admin-kpi-sub">${metrics.personalBillsCount} billed cycles</div>
        </div>

        <div class="admin-kpi-card sky" style="padding: 14px 18px;">
          <div class="admin-kpi-label">Group Spending</div>
          <div class="admin-kpi-value" style="font-size: 20px;">${SpendlyStore.formatINR(metrics.groupSpentPaise)}</div>
          <div class="admin-kpi-sub">Across ${metrics.groupsCount} active groups</div>
        </div>

        <div class="admin-kpi-card navy" style="padding: 14px 18px;">
          <div class="admin-kpi-label">Total Expenditure</div>
          <div class="admin-kpi-value" style="font-size: 20px;">${SpendlyStore.formatINR(metrics.totalSpentPaise)}</div>
          <div class="admin-kpi-sub">Combined platform volume</div>
        </div>

        <div class="admin-kpi-card warning" style="padding: 14px 18px;">
          <div class="admin-kpi-label">Settlements & Sessions</div>
          <div class="admin-kpi-value" style="font-size: 20px;">${metrics.settlementsCount} &bull; ${metrics.sessionsCount}</div>
          <div class="admin-kpi-sub">Settlements &bull; Active devices</div>
        </div>
      </div>

      <!-- Detailed Navigation Tabs -->
      <div class="admin-tabs">
        <button class="admin-tab-btn ${this.activeTab === 'account' ? 'active' : ''}" data-tab="account">Account</button>
        <button class="admin-tab-btn ${this.activeTab === 'expenses' ? 'active' : ''}" data-tab="expenses">Expenses</button>
        <button class="admin-tab-btn ${this.activeTab === 'groups' ? 'active' : ''}" data-tab="groups">Groups (${metrics.groupsCount})</button>
        <button class="admin-tab-btn ${this.activeTab === 'bills' ? 'active' : ''}" data-tab="bills">Bills</button>
        <button class="admin-tab-btn ${this.activeTab === 'settlements' ? 'active' : ''}" data-tab="settlements">Settlements (${metrics.settlementsCount})</button>
        <button class="admin-tab-btn ${this.activeTab === 'sessions' ? 'active' : ''}" data-tab="sessions">Sessions (${metrics.sessionsCount})</button>
      </div>

      <!-- Dynamic Tab Content Container -->
      <div id="admin-user-tab-content">
        <div style="text-align: center; padding: 40px; color: var(--text-muted);">
          Loading tab data...
        </div>
      </div>
    `;

    SpendlyAdmin.renderShell('users', contentHtml);
    this.attachTabEvents();
    this.loadActiveTab();
  },

  attachTabEvents() {
    // Tab switching
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
      btn.onclick = () => {
        const tab = btn.getAttribute('data-tab');
        this.activeTab = tab;
        document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.loadActiveTab();
      };
    });

    // Copy ID button
    const copyBtn = document.getElementById('copy-user-id-btn');
    if (copyBtn && this.userData) {
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(this.userData.user.id);
        SpendlyApp.showToast({
          type: 'success',
          title: 'Copied',
          message: 'User ID copied to clipboard.'
        });
      };
    }
  },

  async loadActiveTab() {
    const container = document.getElementById('admin-user-tab-content');
    if (!container) return;

    container.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--text-muted);">
        Loading ${this.activeTab} records...
      </div>
    `;

    try {
      if (this.activeTab === 'account') {
        this.renderAccountTab(container);
      } else if (this.activeTab === 'expenses') {
        const expData = await SpendlyAdmin.request(`/users/${this.userId}/expenses`);
        this.renderExpensesTab(container, expData);
      } else if (this.activeTab === 'groups') {
        const groupData = await SpendlyAdmin.request(`/users/${this.userId}/groups`);
        this.renderGroupsTab(container, groupData.groups);
      } else if (this.activeTab === 'bills') {
        const billsData = await SpendlyAdmin.request(`/users/${this.userId}/bills`);
        this.renderBillsTab(container, billsData);
      } else if (this.activeTab === 'settlements') {
        const stData = await SpendlyAdmin.request(`/users/${this.userId}/settlements`);
        this.renderSettlementsTab(container, stData.settlements);
      } else if (this.activeTab === 'sessions') {
        const sessData = await SpendlyAdmin.request(`/users/${this.userId}/sessions`);
        this.renderSessionsTab(container, sessData.sessions);
      }
    } catch (err) {
      container.innerHTML = `
        <div class="empty-state" style="padding: 30px; text-align: center;">
          <p style="color: var(--accent-danger);">Failed to load ${this.activeTab}: ${err.message}</p>
        </div>
      `;
    }
  },

  renderAccountTab(container) {
    const { user } = this.userData;

    container.innerHTML = `
      <div class="admin-panel" style="max-width: 800px;">
        <div class="admin-panel-header">
          <h3 class="admin-panel-title">Account Information & Security Profile</h3>
          <span class="admin-badge">${user.isAdmin ? 'Administrator' : 'Standard User'}</span>
        </div>
        <div class="admin-panel-body">
          <div class="admin-health-rows">
            <div class="admin-health-row">
              <span class="admin-health-key">Full User ID</span>
              <span class="admin-health-val">${user.id}</span>
            </div>
            <div class="admin-health-row">
              <span class="admin-health-key">Username</span>
              <span class="admin-health-val">@${SpendlyApp.escapeHtml(user.username)}</span>
            </div>
            <div class="admin-health-row">
              <span class="admin-health-key">Email Address</span>
              <span class="admin-health-val">${SpendlyApp.escapeHtml(user.email)}</span>
            </div>
            <div class="admin-health-row">
              <span class="admin-health-key">Display Name</span>
              <span class="admin-health-val">${SpendlyApp.escapeHtml(user.displayName)}</span>
            </div>
            <div class="admin-health-row">
              <span class="admin-health-key">Bio</span>
              <span class="admin-health-val" style="font-family: inherit;">${user.bio ? SpendlyApp.escapeHtml(user.bio) : '<em>No bio set</em>'}</span>
            </div>
            <div class="admin-health-row">
              <span class="admin-health-key">Registered At</span>
              <span class="admin-health-val">${SpendlyStore.formatDateTime(user.createdAt)}</span>
            </div>
            <div class="admin-health-row">
              <span class="admin-health-key">Profile Last Updated</span>
              <span class="admin-health-val">${SpendlyStore.formatDateTime(user.updatedAt)}</span>
            </div>
            <div class="admin-health-row">
              <span class="admin-health-key">Last Username Change</span>
              <span class="admin-health-val">${user.lastUsernameChange ? SpendlyStore.formatDateTime(user.lastUsernameChange) : 'Never modified (Eligible)'}</span>
            </div>
          </div>

          <div style="margin-top: 24px; padding: 14px 18px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: var(--radius-md); font-size: 13px; color: var(--accent-success); display: flex; align-items: center; gap: 10px;">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span><strong>High-Security Guarantee:</strong> Passwords, OTP codes, reset tickets, and session tokens are strictly hashed/protected and never accessible to the UI.</span>
          </div>
        </div>
      </div>
    `;
  },

  renderExpensesTab(container, { personal, group }) {
    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 24px;">
        <!-- Personal Expenses Table -->
        <div class="admin-panel">
          <div class="admin-panel-header">
            <h3 class="admin-panel-title">Personal Spending Entries (${personal.length})</h3>
            <span class="admin-badge">Own Expenses</span>
          </div>
          <div class="admin-table-container">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Head / Category</th>
                  <th>Cycle #</th>
                  <th style="text-align: right;">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${personal.length === 0 ? `
                  <tr><td colspan="5" style="text-align: center; padding: 24px; color: var(--text-muted);">No personal expenses recorded.</td></tr>
                ` : personal.map(e => `
                  <tr>
                    <td>${SpendlyStore.formatDateTime(e.createdAt)}</td>
                    <td><strong>${SpendlyApp.escapeHtml(e.description)}</strong></td>
                    <td><span class="admin-status-badge inactive">${SpendlyApp.escapeHtml(e.headName)}</span></td>
                    <td>Cycle #${e.cycleNumber}</td>
                    <td style="text-align: right; font-weight: 700; color: var(--text-primary);">${SpendlyStore.formatINR(e.amountPaise)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Group Expenses Table -->
        <div class="admin-panel">
          <div class="admin-panel-header">
            <h3 class="admin-panel-title">Group Split Contributions (${group.length})</h3>
            <span class="admin-badge">Split It</span>
          </div>
          <div class="admin-table-container">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Group Name</th>
                  <th>Description</th>
                  <th>Cycle #</th>
                  <th style="text-align: right;">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${group.length === 0 ? `
                  <tr><td colspan="5" style="text-align: center; padding: 24px; color: var(--text-muted);">No group expenses recorded.</td></tr>
                ` : group.map(g => `
                  <tr>
                    <td>${SpendlyStore.formatDateTime(g.createdAt)}</td>
                    <td><strong>${SpendlyApp.escapeHtml(g.groupName)}</strong></td>
                    <td>${SpendlyApp.escapeHtml(g.description)}</td>
                    <td>Cycle #${g.cycleNumber}</td>
                    <td style="text-align: right; font-weight: 700; color: var(--accent-primary);">${SpendlyStore.formatINR(g.amountPaise)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  },

  renderGroupsTab(container, groups) {
    container.innerHTML = `
      <div class="admin-panel">
        <div class="admin-panel-header">
          <h3 class="admin-panel-title">Group Memberships (${groups.length})</h3>
        </div>
        <div class="admin-table-container">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Group Name</th>
                <th>Role</th>
                <th>Alias (Temp Name)</th>
                <th>Members</th>
                <th>Cycle #</th>
                <th>Cycle Status</th>
                <th>Cycle Spent</th>
                <th>Joined At</th>
              </tr>
            </thead>
            <tbody>
              ${groups.length === 0 ? `
                <tr><td colspan="8" style="text-align: center; padding: 30px; color: var(--text-muted);">User does not belong to any groups.</td></tr>
              ` : groups.map(g => `
                <tr>
                  <td><strong>${SpendlyApp.escapeHtml(g.groupName)}</strong></td>
                  <td>
                    <span class="admin-status-badge ${g.role === 'admin' ? 'admin' : 'inactive'}">
                      ${g.role}
                    </span>
                  </td>
                  <td>${g.temporaryName ? SpendlyApp.escapeHtml(g.temporaryName) : '<span style="color: var(--text-muted);">None</span>'}</td>
                  <td>${g.memberCount} members</td>
                  <td>Cycle #${g.currentCycleNumber}</td>
                  <td>
                    <span class="admin-status-badge ${g.currentCycleStatus === 'active' ? 'active' : 'completed'}">
                      ${g.currentCycleStatus}
                    </span>
                  </td>
                  <td style="font-weight: 600;">${SpendlyStore.formatINR(g.activeCycleSpentPaise)}</td>
                  <td>${SpendlyStore.formatDateTime(g.joinedAt)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  renderBillsTab(container, { personalBills, groupBills }) {
    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 24px;">
        <!-- Personal Bills -->
        <div class="admin-panel">
          <div class="admin-panel-header">
            <h3 class="admin-panel-title">Permanent Personal Cycle Bills (${personalBills.length})</h3>
            <span class="admin-badge">Immutable Snapshots</span>
          </div>
          <div class="admin-table-container">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Cycle #</th>
                  <th>Date Generated</th>
                  <th>Budget Set</th>
                  <th>Total Spent</th>
                  <th>Balance State</th>
                  <th>Entries</th>
                </tr>
              </thead>
              <tbody>
                ${personalBills.length === 0 ? `
                  <tr><td colspan="6" style="text-align: center; padding: 24px; color: var(--text-muted);">No personal bills generated yet.</td></tr>
                ` : personalBills.map(b => `
                  <tr>
                    <td><strong>Cycle #${b.cycleNumber}</strong></td>
                    <td>${SpendlyStore.formatDateTime(b.createdAt)}</td>
                    <td>${SpendlyStore.formatINR(b.totalSetAmountPaise)}</td>
                    <td style="font-weight: 700;">${SpendlyStore.formatINR(b.totalSpentPaise)}</td>
                    <td>
                      ${b.totalOverspentPaise > 0 ? `
                        <span class="admin-status-badge" style="background: var(--accent-danger-subtle); color: var(--accent-danger);">
                          Overspent: ${SpendlyStore.formatINR(b.totalOverspentPaise)}
                        </span>
                      ` : `
                        <span class="admin-status-badge active">
                          Saved: ${SpendlyStore.formatINR(b.totalRemainingPaise)}
                        </span>
                      `}
                    </td>
                    <td>${b.entryCount} items</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Group Bills -->
        <div class="admin-panel">
          <div class="admin-panel-header">
            <h3 class="admin-panel-title">Permanent Group Split Bills (${groupBills.length})</h3>
            <span class="admin-badge">Immutable Snapshots</span>
          </div>
          <div class="admin-table-container">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Group Name</th>
                  <th>Cycle #</th>
                  <th>Date Generated</th>
                  <th>Total Group Spent</th>
                  <th>Members</th>
                  <th style="text-align: right;">Equal Share</th>
                </tr>
              </thead>
              <tbody>
                ${groupBills.length === 0 ? `
                  <tr><td colspan="6" style="text-align: center; padding: 24px; color: var(--text-muted);">No group bills generated yet.</td></tr>
                ` : groupBills.map(gb => `
                  <tr>
                    <td><strong>${SpendlyApp.escapeHtml(gb.groupName)}</strong></td>
                    <td>Cycle #${gb.cycleNumber}</td>
                    <td>${SpendlyStore.formatDateTime(gb.createdAt)}</td>
                    <td style="font-weight: 700;">${SpendlyStore.formatINR(gb.totalSpentPaise)}</td>
                    <td>${gb.memberCount} members</td>
                    <td style="text-align: right; font-weight: 700; color: var(--accent-secondary);">${SpendlyStore.formatINR(gb.equalSharePaise)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  },

  renderSettlementsTab(container, settlements) {
    container.innerHTML = `
      <div class="admin-panel">
        <div class="admin-panel-header">
          <h3 class="admin-panel-title">Two-Step Financial Settlements (${settlements.length})</h3>
          <span class="admin-badge">Deterministic Debts</span>
        </div>
        <div class="admin-table-container">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Group</th>
                <th>Debtor (Payer)</th>
                <th>Creditor (Receiver)</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Created</th>
                <th>Paid At</th>
                <th>Confirmed At</th>
              </tr>
            </thead>
            <tbody>
              ${settlements.length === 0 ? `
                <tr><td colspan="8" style="text-align: center; padding: 30px; color: var(--text-muted);">No settlements recorded for this user.</td></tr>
              ` : settlements.map(s => {
                let statusBadge = '<span class="admin-status-badge pending">Pending Payment</span>';
                if (s.status === 'pending_confirmation') {
                  statusBadge = '<span class="admin-status-badge pending" style="color: #d97706;">Pending Confirmation</span>';
                } else if (s.status === 'completed') {
                  statusBadge = '<span class="admin-status-badge completed">Completed</span>';
                }

                return `
                  <tr>
                    <td><strong>${SpendlyApp.escapeHtml(s.groupName)}</strong></td>
                    <td>
                      ${s.isPayer ? `<strong>You (@${s.payer.username})</strong>` : `@${s.payer.username}`}
                    </td>
                    <td>
                      ${s.isReceiver ? `<strong>You (@${s.receiver.username})</strong>` : `@${s.receiver.username}`}
                    </td>
                    <td style="font-weight: 700; color: var(--text-primary);">${SpendlyStore.formatINR(s.amountPaise)}</td>
                    <td>${statusBadge}</td>
                    <td>${SpendlyStore.formatDateTime(s.createdAt)}</td>
                    <td>${s.paidAt ? SpendlyStore.formatDateTime(s.paidAt) : '-'}</td>
                    <td>${s.confirmedAt ? SpendlyStore.formatDateTime(s.confirmedAt) : '-'}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  renderSessionsTab(container, sessions) {
    container.innerHTML = `
      <div class="admin-panel">
        <div class="admin-panel-header">
          <h3 class="admin-panel-title">Multi-Device User Sessions (${sessions.length})</h3>
          <span class="admin-badge">Security Managed</span>
        </div>
        <div class="admin-table-container">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Device / Client Info</th>
                <th>Created At</th>
                <th>Last Active At</th>
                <th>State</th>
                <th style="text-align: right;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${sessions.length === 0 ? `
                <tr><td colspan="5" style="text-align: center; padding: 30px; color: var(--text-muted);">No active sessions found for this user.</td></tr>
              ` : sessions.map(s => `
                <tr>
                  <td>
                    <div style="font-weight: 600;">${SpendlyApp.escapeHtml(s.deviceInfo)}</div>
                    <div style="font-size: 11px; color: var(--text-muted); font-family: monospace;">ID: ${s.id.slice(0, 16)}...</div>
                  </td>
                  <td>${SpendlyStore.formatDateTime(s.createdAt)}</td>
                  <td>${SpendlyStore.formatDateTime(s.lastActiveAt)}</td>
                  <td>
                    <span class="admin-status-badge ${s.isRecent ? 'active' : 'inactive'}">
                      ${s.isRecent ? 'Active' : 'Dormant'}
                    </span>
                  </td>
                  <td style="text-align: right;">
                    <button class="btn btn-sm btn-danger revoke-session-btn" data-session-id="${s.id}" data-device="${SpendlyApp.escapeHtml(s.deviceInfo)}">
                      Revoke
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Attach revoke session events
    container.querySelectorAll('.revoke-session-btn').forEach(btn => {
      btn.onclick = () => {
        const sessionId = btn.getAttribute('data-session-id');
        const deviceInfo = btn.getAttribute('data-device');

        SpendlyApp.showConfirmModal({
          title: 'Revoke User Session',
          message: `Are you sure you want to forcibly terminate the session for device "<strong>${deviceInfo}</strong>"? The user will be required to log in again on that device.`,
          confirmText: 'Revoke Session',
          isDanger: true,
          onConfirm: async (closeModal) => {
            try {
              await SpendlyAdmin.request(`/users/${this.userId}/sessions/${sessionId}/revoke`, {
                method: 'POST'
              });
              SpendlyApp.showToast({
                type: 'success',
                title: 'Session Revoked',
                message: 'The session was terminated successfully.'
              });
              closeModal();
              this.loadActiveTab();
            } catch (err) {
              SpendlyApp.showToast({
                type: 'error',
                title: 'Revocation Failed',
                message: err.message
              });
            }
          }
        });
      };
    });
  }
};

window.SpendlyAdminUserDetailsView = SpendlyAdminUserDetailsView;
