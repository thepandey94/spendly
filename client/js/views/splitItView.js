/**
 * Spendly Split It View (Collaborative Group Expense Engine)
 * Implements 50-member groups, invitations, temporary names, member roles,
 * real-time synchronization, group billing, deterministic settlements, and confirmations.
 */
const SpendlySplitItView = {
  currentGroupId: null,
  groupDetails: null,
  activeWsUnsubscribe: null,

  async render(groupId = null) {
    this.currentGroupId = groupId;

    // Clean up any previous WebSocket room subscription
    if (this.activeWsUnsubscribe) {
      this.activeWsUnsubscribe();
      this.activeWsUnsubscribe = null;
    }

    const container = document.getElementById('main-view-container');

    if (groupId) {
      container.innerHTML = `
        <div id="group-detail-container">
          <div style="text-align: center; padding: 40px; color: var(--text-muted);">
            Loading group expenses...
          </div>
        </div>
      `;
      await this.loadGroupDetail(groupId);
    } else {
      container.innerHTML = `
        <div class="page-header">
          <div>
            <h1 class="page-title">Split It</h1>
            <p class="page-subtitle">Collaborate with roommates, friends, and travel groups</p>
          </div>
          <button class="btn btn-primary" id="create-group-btn">
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor"/></svg>
            Create New Group
          </button>
        </div>

        <div id="groups-list-container">
          <div style="text-align: center; padding: 40px; color: var(--text-muted);">
            Loading your groups...
          </div>
        </div>
      `;

      await this.loadGroupsList();
      const createBtn = document.getElementById('create-group-btn');
      if (createBtn) createBtn.onclick = () => this.showCreateGroupModal();
    }
  },

  async loadGroupsList() {
    try {
      const res = await SpendlyAPI.get('/groups');
      const groups = res.groups || [];
      const container = document.getElementById('groups-list-container');

      if (groups.length === 0) {
        container.innerHTML = `
          <div class="card empty-state">
            <div class="empty-state-icon">👥</div>
            <div class="empty-state-title">No Groups Yet</div>
            <p class="empty-state-text">Create a shared group for your flat, roommates, or trip to start splitting expenses collaboratively.</p>
            <button class="btn btn-primary" onclick="SpendlySplitItView.showCreateGroupModal()">Create Your First Group</button>
          </div>
        `;
        return;
      }

      container.innerHTML = `
        <div class="groups-list-grid">
          ${groups.map(g => `
            <div class="group-summary-card" onclick="window.location.hash = '#/split-it/${g.id}'">
              <div class="group-card-header">
                <div>
                  <div class="group-card-title">${this.escapeHtml(g.name)}</div>
                  <div style="display: flex; gap: 8px; margin-top: 6px;">
                    ${g.role === 'admin' ? '<span class="badge badge-amber">Admin</span>' : '<span class="badge badge-secondary">Member</span>'}
                    ${g.temporary_name ? `<span class="badge badge-cyan" title="Group display name">${this.escapeHtml(g.temporary_name)}</span>` : ''}
                  </div>
                </div>
                <span class="badge ${g.cycle_status === 'active' ? 'badge-emerald' : 'badge-rose'}">
                  Cycle #${g.current_cycle_number || 1} ${g.cycle_status === 'active' ? 'Active' : 'Billed'}
                </span>
              </div>

              <div class="group-card-stats">
                <span><strong>${g.member_count}</strong> / 50 members</span>
                <span style="color: var(--accent-primary); font-weight: 600;">Open Group &rarr;</span>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    } catch (err) {
      document.getElementById('groups-list-container').innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title" style="color: var(--accent-danger);">Failed to load groups</div>
          <p class="empty-state-text">${err.message}</p>
        </div>
      `;
    }
  },

  async loadGroupDetail(groupId) {
    try {
      this.groupDetails = await SpendlyAPI.get(`/groups/${groupId}`);
      this.renderGroupDetailContent();

      // Subscribe to real-time WebSocket room for this group
      SpendlyWS.subscribeGroup(groupId);

      // Register real-time event listeners
      const offExpenseAdded = SpendlyWS.on('expense_added', (payload) => {
        if (payload.groupId === groupId) this.loadGroupDetail(groupId);
      });
      const offExpenseUpdated = SpendlyWS.on('expense_updated', (payload) => {
        if (payload.groupId === groupId) this.loadGroupDetail(groupId);
      });
      const offExpenseDeleted = SpendlyWS.on('expense_deleted', (payload) => {
        if (payload.groupId === groupId) this.loadGroupDetail(groupId);
      });
      const offBilled = SpendlyWS.on('group_billed', (payload) => {
        if (payload.groupId === groupId) this.loadGroupDetail(groupId);
      });
      const offNewCycle = SpendlyWS.on('new_cycle_started', (payload) => {
        if (payload.groupId === groupId) this.loadGroupDetail(groupId);
      });
      const offSettlement = SpendlyWS.on('settlement_updated', (payload) => {
        this.loadGroupDetail(groupId);
      });

      this.activeWsUnsubscribe = () => {
        SpendlyWS.unsubscribeGroup(groupId);
        offExpenseAdded();
        offExpenseUpdated();
        offExpenseDeleted();
        offBilled();
        offNewCycle();
        offSettlement();
      };
    } catch (err) {
      document.getElementById('group-detail-container').innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title" style="color: var(--accent-danger);">Error Loading Group</div>
          <p class="empty-state-text">${err.message}</p>
          <button class="btn btn-secondary" onclick="window.location.hash = '#/split-it'">Back to Groups</button>
        </div>
      `;
    }
  },

  renderGroupDetailContent() {
    const container = document.getElementById('group-detail-container');
    const { group, activeCycle, latestCycle, hasActiveCycle, canRemoveFromAccount, members, expenses, liveTotals, latestBill, activeSettlements } = this.groupDetails;
    const isAdmin = group.currentUserRole === 'admin';
    const currentUserId = SpendlyStore.state.user.id;
    const currentMember = members.find(m => m.userId === currentUserId);
    const pendingLeaveMembers = members.filter(m => m.leaveRequested);

    // Group expenses by member
    const expensesByMember = new Map();
    members.forEach(m => expensesByMember.set(m.userId, []));
    expenses.forEach(e => {
      if (!expensesByMember.has(e.user_id)) expensesByMember.set(e.user_id, []);
      expensesByMember.get(e.user_id).push(e);
    });

    container.innerHTML = `
      <!-- Header with Navigation and Admin / Member Actions -->
      <div style="margin-bottom: 20px;">
        <button class="btn btn-secondary btn-sm" onclick="window.location.hash = '#/split-it'" style="margin-bottom: 12px;">
          &larr; Back to All Groups
        </button>
      </div>

      <div class="group-detail-header">
        <div>
          <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
            <h1 class="page-title" style="margin-bottom: 0;">${this.escapeHtml(group.name)}</h1>
            ${isAdmin ? '<span class="badge badge-amber">Admin</span>' : '<span class="badge badge-secondary">Member</span>'}
            <span class="badge ${hasActiveCycle ? 'badge-emerald' : 'badge-rose'}">
              Cycle #${activeCycle ? activeCycle.cycle_number : (latestCycle ? latestCycle.cycle_number : 1)} ${hasActiveCycle ? 'Active' : 'Billed'}
            </span>
          </div>
          <p class="page-subtitle">
            ${members.length} member(s) (Maximum 50)
          </p>
        </div>

        <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">
          ${canRemoveFromAccount ? `
            <button class="btn btn-secondary btn-sm" id="remove-group-from-account-btn" title="Remove group from your own account">
              Remove Group From My Account
            </button>
          ` : ''}

          ${isAdmin ? `
            <button class="btn btn-secondary btn-sm" id="invite-member-btn" title="Invite new member">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" stroke="currentColor" stroke-width="2"/></svg>
              Invite Member
            </button>
            ${hasActiveCycle ? `
              <button class="btn btn-primary btn-sm" id="group-bill-btn">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="2"/></svg>
                Bill This Cycle
              </button>
            ` : `
              <button class="btn btn-primary btn-sm" id="group-new-cycle-btn">
                Start a New Cycle
              </button>
            `}
            <button class="btn btn-danger btn-sm" id="delete-group-btn" title="Delete Group">
              Delete Group
            </button>
          ` : (currentMember && currentMember.leaveRequested) ? `
            <span class="badge badge-amber" style="padding: 6px 12px; font-size: 12px;">Leave Requested (Pending Admin)</span>
          ` : `
            <button class="btn btn-secondary btn-sm" id="request-leave-btn">
              Request to Leave
            </button>
          `}
        </div>
      </div>

      <!-- Admin Pending Leave Request Notice Banner (Part 10) -->
      ${isAdmin && pendingLeaveMembers.length > 0 ? `
        <div class="leave-request-banner">
          <div class="leave-request-banner-text">
            ⚠️ <strong>Leave Request Pending:</strong>
            ${pendingLeaveMembers.map(m => `
              <span>${this.escapeHtml(m.displayName || m.username)} has requested to leave "${this.escapeHtml(group.name)}".</span>
            `).join(' ')}
            ${hasActiveCycle && expenses.length > 0 ? '<br><small style="color: var(--accent-warning);">Note: Complete billing before approving leave requests.</small>' : ''}
          </div>
          <div class="leave-request-banner-actions">
            ${pendingLeaveMembers.map(m => `
              <button class="btn btn-sm btn-primary approve-leave-action-btn" data-user-id="${m.userId}">
                Approve Leave
              </button>
              <button class="btn btn-sm btn-secondary reject-leave-action-btn" data-user-id="${m.userId}">
                Reject
              </button>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${!hasActiveCycle ? `
        <div class="card" style="border-left: 4px solid var(--accent-cyan); margin-bottom: 24px;">
          <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 6px;">This Billing Cycle is Closed</h3>
          <p style="font-size: 13px; color: var(--text-secondary);">
            The bill for this cycle has been generated and locked. ${isAdmin ? 'As admin, click "Start a New Cycle" above to reopen expense entry.' : 'Waiting for admin to start a new billing cycle.'}
          </p>
        </div>
      ` : ''}

      <!-- Member Expense Columns Table (Part 9) - Exactly N Columns for N Members -->
      <div class="split-it-table-card">
        <div class="mobile-scroll-cue">↔ Swipe horizontally to view all member columns</div>
        <div class="split-it-table-container">
          <table class="split-it-table" style="min-width: ${Math.max(680, members.length * 240)}px;">
            <thead>
              <tr>
                ${members.map(m => {
                  const isMe = m.userId === currentUserId;
                  const displayName = this.escapeHtml(m.temporaryName || m.displayName || m.username);
                  return `
                    <th class="${isMe ? 'is-me' : ''}" style="width: ${100 / members.length}%;">
                      <div class="member-th-header">
                        <div class="member-th-top">
                          <div class="member-th-user" onclick="window.location.hash = '#/profile/${m.userId}'" style="cursor: pointer;" title="View ${displayName}'s profile">
                            ${m.avatarUrl ? `
                              <img src="${m.avatarUrl}" class="user-avatar-img" style="width: 32px; height: 32px;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
                              <div class="user-avatar-placeholder" style="width: 32px; height: 32px; font-size: 12px; display: none;">
                                ${displayName[0].toUpperCase()}
                              </div>
                            ` : `
                              <div class="user-avatar-placeholder" style="width: 32px; height: 32px; font-size: 12px;">
                                ${displayName[0].toUpperCase()}
                              </div>
                            `}
                            <div>
                              <div class="member-th-name">
                                ${displayName}
                                ${isMe ? '<span style="font-size: 11px; color: var(--accent-primary); font-weight: 600;"> (You)</span>' : ''}
                              </div>
                              <div class="member-th-tag">@${this.escapeHtml(m.username)}</div>
                            </div>
                          </div>
                          ${isAdmin && !isMe ? `
                            <button class="action-icon-btn admin-temp-name-btn" title="Set group temporary name" data-user-id="${m.userId}" data-current="${this.escapeHtml(m.temporaryName || '')}">
                              <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" stroke="currentColor"/></svg>
                            </button>
                          ` : ''}
                        </div>
                        <div class="member-th-spent-badge">
                          <span>Total Spent</span>
                          <strong>${SpendlyStore.formatINR(m.spent)}</strong>
                        </div>
                      </div>
                    </th>
                  `;
                }).join('')}
              </tr>
            </thead>
            <tbody>
              <tr>
                ${members.map(m => {
                  const isMe = m.userId === currentUserId;
                  const memberExpenses = expensesByMember.get(m.userId) || [];
                  return `
                    <td class="${isMe ? 'is-me' : ''}">
                      <div class="member-col-expenses">
                        ${memberExpenses.length === 0 ? `
                          <div style="text-align: center; padding: 24px 10px; color: var(--text-muted); font-size: 12px; font-style: italic;">
                            No expenses entered
                          </div>
                        ` : memberExpenses.map(e => `
                          <div class="group-exp-row" data-exp-id="${e.id}">
                            <div class="group-exp-info">
                              <span class="group-exp-desc">${this.escapeHtml(e.description)}</span>
                              <span class="group-exp-meta">${SpendlyStore.formatDateTime(e.created_at)}</span>
                            </div>
                            <div class="group-exp-right">
                              <span class="group-exp-amount">${SpendlyStore.formatINR(e.amount)}</span>
                              ${isMe && hasActiveCycle ? `
                                <button class="action-icon-btn edit-group-exp-btn" title="Edit Expense" data-exp-id="${e.id}" data-desc="${this.escapeHtml(e.description)}" data-amount="${e.amount / 100}">
                                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor"/></svg>
                                </button>
                                <button class="action-icon-btn delete delete-group-exp-btn" title="Delete Expense" data-exp-id="${e.id}">
                                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke="currentColor"/></svg>
                                </button>
                              ` : ''}
                            </div>
                          </div>
                        `).join('')}

                        ${isMe && hasActiveCycle ? `
                          <button class="add-group-expense-col-btn add-my-expense-btn">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2"/></svg>
                            Add Expense
                          </button>
                        ` : ''}
                      </div>
                    </td>
                  `;
                }).join('')}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- All Group Calculations Displayed at BOTTOM of the page (Part 9) -->
      <div class="bottom-calculations-section">
        <h3 class="bottom-section-title">Group Billing & Settlement Calculations</h3>

        <!-- Top KPI Grid -->
        <div class="kpi-grid">
          <div class="kpi-card">
            <span class="kpi-label">Total Group Bill</span>
            <span class="kpi-value">${SpendlyStore.formatINR(liveTotals.totalSpent)}</span>
            <span class="kpi-subtext">${expenses.length} expense transaction(s)</span>
          </div>

          <div class="kpi-card cyan">
            <span class="kpi-label">Bill Per Active Member</span>
            <span class="kpi-value" style="color: var(--accent-cyan);">${SpendlyStore.formatINR(liveTotals.equalShare)}</span>
            <span class="kpi-subtext">Equal share for ${members.length} member(s)</span>
          </div>

          <div class="kpi-card">
            <span class="kpi-label">Your Net Position</span>
            ${(() => {
              const mySpent = currentMember ? currentMember.spent : 0;
              const myBal = currentMember ? currentMember.balance : 0;
              return `
                <span class="kpi-value" style="color: ${myBal >= 0 ? 'var(--accent-primary)' : 'var(--accent-danger)'};">
                  ${myBal >= 0 ? `+${SpendlyStore.formatINR(myBal)}` : `-${SpendlyStore.formatINR(-myBal)}`}
                </span>
                <span class="kpi-subtext">
                  Spent ${SpendlyStore.formatINR(mySpent)} (${myBal >= 0 ? 'Receivable' : 'Owed'})
                </span>
              `;
            })()}
          </div>
        </div>

        <!-- Member-by-Member Breakdown Table (Part 9) -->
        <div class="group-breakdown-card">
          <div style="font-family: var(--font-heading); font-size: 16px; font-weight: 700; color: var(--text-primary); margin-bottom: 8px;">
            Member Spending & Balance Breakdown
          </div>
          <div class="table-responsive">
            <table class="group-breakdown-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Role</th>
                  <th style="text-align: right;">Total Spent</th>
                  <th style="text-align: right;">Equal Share</th>
                  <th style="text-align: right;">Net Balance</th>
                  <th style="text-align: right;">Status</th>
                </tr>
              </thead>
              <tbody>
                ${members.map(m => {
                  const isMe = m.userId === currentUserId;
                  const displayName = this.escapeHtml(m.temporaryName || m.displayName || m.username);
                  const bal = m.balance;
                  return `
                    <tr>
                      <td>
                        <a href="#/profile/${m.userId}" style="text-decoration: none; color: inherit; display: inline-block;" title="View ${displayName}'s profile">
                          <strong>${displayName}</strong>
                          ${isMe ? '<span style="font-size: 11px; color: var(--accent-primary); font-weight: 600;"> (You)</span>' : ''}
                          <span style="font-size: 11px; color: var(--text-muted); display: block;">@${this.escapeHtml(m.username)}</span>
                        </a>
                      </td>
                      <td>
                        <span class="badge ${m.role === 'admin' ? 'badge-amber' : 'badge-secondary'}" style="font-size: 11px;">
                          ${m.role === 'admin' ? 'Admin' : 'Member'}
                        </span>
                      </td>
                      <td style="text-align: right; font-family: var(--font-heading); font-weight: 700;">
                        ${SpendlyStore.formatINR(m.spent)}
                      </td>
                      <td style="text-align: right; font-family: var(--font-heading);">
                        ${SpendlyStore.formatINR(liveTotals.equalShare)}
                      </td>
                      <td style="text-align: right; font-family: var(--font-heading); font-weight: 700; color: ${bal > 0 ? 'var(--accent-primary)' : bal < 0 ? 'var(--accent-danger)' : 'var(--text-muted)'};">
                        ${bal > 0 ? `+${SpendlyStore.formatINR(bal)}` : bal < 0 ? `-${SpendlyStore.formatINR(-bal)}` : '₹0.00'}
                      </td>
                      <td style="text-align: right;">
                        <span class="badge ${bal > 0 ? 'badge-emerald' : bal < 0 ? 'badge-rose' : 'badge-secondary'}">
                          ${bal > 0 ? 'Gets Back' : bal < 0 ? 'Needs to Pay' : 'Settled'}
                        </span>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Settlements Panel: Who Needs to Pay Whom (Part 9) -->
        <div class="settlements-panel">
          <div class="settlements-title">
            <span>Settlement Information (Who Pays Whom)</span>
            ${activeSettlements && activeSettlements.length > 0 ? `
              <span class="badge badge-emerald">From Bill #${latestBill ? latestBill.cycle_number : ''}</span>
            ` : `
              <span class="badge badge-secondary">Real-Time Projected</span>
            `}
          </div>

          ${activeSettlements && activeSettlements.length > 0 ? `
            <div>
              ${activeSettlements.map(s => {
                const isPayer = s.payer_id === currentUserId;
                const isReceiver = s.receiver_id === currentUserId;
                const payerName = s.payer_name || s.payer_username;
                const receiverName = s.receiver_name || s.receiver_username;

                return `
                  <div class="settlement-item">
                    <div class="settlement-instruction">
                      <strong>${this.escapeHtml(payerName)}</strong>
                      <span class="settlement-arrow">&rarr;</span>
                      <strong>${this.escapeHtml(receiverName)}</strong>
                    </div>

                    <div style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap;">
                      <span class="settlement-amount">${SpendlyStore.formatINR(s.amount)}</span>
                      <span class="badge ${s.status === 'completed' ? 'badge-emerald' : s.status === 'pending_confirmation' ? 'badge-cyan' : 'badge-amber'}">
                        ${s.status === 'completed' ? '✓ Completed' : s.status === 'pending_confirmation' ? '⏳ Pending Confirmation' : 'Pending'}
                      </span>

                      ${isPayer && s.status === 'pending' ? `
                        <button class="btn btn-sm btn-primary mark-paid-btn" data-settlement-id="${s.id}">
                          Mark as Paid
                        </button>
                      ` : ''}

                      ${isReceiver && s.status === 'pending_confirmation' ? `
                        <button class="btn btn-sm btn-primary confirm-received-btn" data-settlement-id="${s.id}">
                          Confirm Received
                        </button>
                        <button class="btn btn-sm btn-secondary dispute-btn" data-settlement-id="${s.id}">
                          Not Received
                        </button>
                      ` : ''}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          ` : liveTotals.suggestedSettlements && liveTotals.suggestedSettlements.length > 0 ? `
            <div>
              <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 12px;">
                These are live settlement suggestions. Official settlement tracking begins once billing is generated.
              </p>
              ${liveTotals.suggestedSettlements.map(s => {
                const payer = members.find(m => m.userId === s.payerId);
                const receiver = members.find(m => m.userId === s.receiverId);
                return `
                  <div class="settlement-item">
                    <div class="settlement-instruction">
                      <strong>${this.escapeHtml(payer ? (payer.temporaryName || payer.displayName || payer.username) : 'Payer')}</strong>
                      <span class="settlement-arrow">&rarr;</span>
                      <strong>${this.escapeHtml(receiver ? (receiver.temporaryName || receiver.displayName || receiver.username) : 'Receiver')}</strong>
                    </div>
                    <div style="display: flex; align-items: center; gap: 12px;">
                      <span class="settlement-amount">${SpendlyStore.formatINR(s.amount)}</span>
                      <span class="badge badge-secondary">Projected on Billing</span>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          ` : `
            <div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 14px;">
              All members are even! No settlements required.
            </div>
          `}
        </div>
      </div>
    `;

    this.attachGroupDetailEvents();
  },

  attachGroupDetailEvents() {
    const groupId = this.currentGroupId;

    // Add My Expense button (matches all column triggers for user)
    document.querySelectorAll('.add-my-expense-btn').forEach(btn => {
      btn.onclick = () => this.showAddGroupExpenseModal(groupId);
    });

    // Remove Group From My Account (Part 5)
    const removeAccountBtn = document.getElementById('remove-group-from-account-btn');
    if (removeAccountBtn) {
      removeAccountBtn.onclick = () => {
        SpendlyApp.showConfirmModal({
          title: 'Remove Group From My Account?',
          message: 'This will remove the group from your active account while preserving all historical bills. Other members will not be affected. You cannot undo this.',
          confirmText: 'Remove Group',
          isDanger: true,
          onConfirm: async (close) => {
            try {
              await SpendlyAPI.post(`/groups/${groupId}/remove-from-account`);
              SpendlyApp.showToast({ type: 'success', title: 'Group Removed', message: 'Group was successfully removed from your account.' });
              close();
              window.location.hash = '#/split-it';
            } catch (err) {
              SpendlyApp.showToast({ type: 'error', title: 'Error', message: err.message });
            }
          }
        });
      };
    }

    // Admin: Approve / Reject leave requests from banner (Part 10)
    document.querySelectorAll('.approve-leave-action-btn').forEach(btn => {
      btn.onclick = async () => {
        const targetUserId = btn.getAttribute('data-user-id');
        try {
          await SpendlyAPI.post(`/groups/${groupId}/members/${targetUserId}/approve-leave`);
          SpendlyApp.showToast({ type: 'success', title: 'Leave Approved', message: 'Member leave request was approved.' });
          this.loadGroupDetail(groupId);
        } catch (err) {
          SpendlyApp.showToast({ type: 'error', title: 'Action Prohibited', message: err.message });
        }
      };
    });

    document.querySelectorAll('.reject-leave-action-btn').forEach(btn => {
      btn.onclick = async () => {
        const targetUserId = btn.getAttribute('data-user-id');
        try {
          await SpendlyAPI.post(`/groups/${groupId}/members/${targetUserId}/reject-leave`);
          SpendlyApp.showToast({ type: 'info', title: 'Leave Declined', message: 'Member leave request was declined.' });
          this.loadGroupDetail(groupId);
        } catch (err) {
          SpendlyApp.showToast({ type: 'error', title: 'Error', message: err.message });
        }
      };
    });

    // Edit Group Expense buttons
    document.querySelectorAll('.edit-group-exp-btn').forEach(btn => {
      btn.onclick = () => {
        const expId = btn.getAttribute('data-exp-id');
        const desc = btn.getAttribute('data-desc');
        const amount = btn.getAttribute('data-amount');
        this.showEditGroupExpenseModal(groupId, expId, desc, amount);
      };
    });

    // Delete Group Expense buttons
    document.querySelectorAll('.delete-group-exp-btn').forEach(btn => {
      btn.onclick = () => {
        const expId = btn.getAttribute('data-exp-id');
        SpendlyApp.showConfirmModal({
          title: 'Delete Expense?',
          message: 'Are you sure you want to delete this expense from the group?',
          confirmText: 'Delete',
          isDanger: true,
          onConfirm: async (close) => {
            try {
              await SpendlyAPI.delete(`/groups/${groupId}/expenses/${expId}`);
              SpendlyApp.showToast({ type: 'success', title: 'Deleted', message: 'Expense deleted.' });
              close();
              this.loadGroupDetail(groupId);
            } catch (err) {
              SpendlyApp.showToast({ type: 'error', title: 'Error', message: err.message });
            }
          }
        });
      };
    });

    // Admin: Invite Member
    const inviteBtn = document.getElementById('invite-member-btn');
    if (inviteBtn) {
      inviteBtn.onclick = () => this.showInviteMemberModal(groupId);
    }

    // Admin: Temporary Name buttons
    document.querySelectorAll('.admin-temp-name-btn').forEach(btn => {
      btn.onclick = () => {
        const userId = btn.getAttribute('data-user-id');
        const currentName = btn.getAttribute('data-current');
        this.showSetTemporaryNameModal(groupId, userId, currentName);
      };
    });

    // Admin: Group Billing
    const billBtn = document.getElementById('group-bill-btn');
    if (billBtn) {
      billBtn.onclick = () => {
        SpendlyApp.showConfirmModal({
          title: 'Generate Group Billing?',
          message: 'This will lock the current cycle atomically, calculate equal shares and deterministic settlements, and generate a permanent immutable bill for all members.',
          confirmText: 'Generate Bill',
          onConfirm: async (close) => {
            try {
              await SpendlyAPI.post(`/groups/${groupId}/billing`);
              SpendlyApp.showToast({ type: 'success', title: 'Billing Complete', message: 'Group bill generated!' });
              close();
              this.loadGroupDetail(groupId);
            } catch (err) {
              SpendlyApp.showToast({ type: 'error', title: 'Billing Error', message: err.message });
            }
          }
        });
      };
    }

    // Admin: Start New Group Cycle
    const newCycleBtn = document.getElementById('group-new-cycle-btn');
    if (newCycleBtn) {
      newCycleBtn.onclick = async () => {
        try {
          await SpendlyAPI.post(`/groups/${groupId}/start-new-cycle`);
          SpendlyApp.showToast({ type: 'success', title: 'Cycle Started', message: 'New group cycle opened.' });
          this.loadGroupDetail(groupId);
        } catch (err) {
          SpendlyApp.showToast({ type: 'error', title: 'Error', message: err.message });
        }
      };
    }

    // Admin: Delete Group
    const deleteGroupBtn = document.getElementById('delete-group-btn');
    if (deleteGroupBtn) {
      deleteGroupBtn.onclick = () => {
        SpendlyApp.showConfirmModal({
          title: 'Delete Entire Group?',
          message: 'Deleting this group is permanent. Historical bills will be preserved. Are you sure you want to proceed?',
          confirmText: 'Delete Group',
          isDanger: true,
          onConfirm: async (close) => {
            try {
              await SpendlyAPI.delete(`/groups/${groupId}`);
              SpendlyApp.showToast({ type: 'success', title: 'Group Deleted', message: 'Group has been deleted.' });
              close();
              window.location.hash = '#/split-it';
            } catch (err) {
              SpendlyApp.showToast({ type: 'error', title: 'Error', message: err.message });
            }
          }
        });
      };
    }

    // Member: Request to leave
    const leaveBtn = document.getElementById('request-leave-btn');
    if (leaveBtn) {
      leaveBtn.onclick = () => {
        SpendlyApp.showConfirmModal({
          title: 'Request to Leave Group?',
          message: 'Your leave request will be sent to the admin. Note that leave requests can only be approved after billing has been completed.',
          confirmText: 'Submit Request',
          onConfirm: async (close) => {
            try {
              await SpendlyAPI.post(`/groups/${groupId}/leave-request`);
              SpendlyApp.showToast({ type: 'info', title: 'Request Sent', message: 'Leave request submitted to admin.' });
              close();
              this.loadGroupDetail(groupId);
            } catch (err) {
              SpendlyApp.showToast({ type: 'error', title: 'Error', message: err.message });
            }
          }
        });
      };
    }

    // Settlement Actions
    document.querySelectorAll('.mark-paid-btn').forEach(btn => {
      btn.onclick = async () => {
        const sId = btn.getAttribute('data-settlement-id');
        try {
          await SpendlyAPI.post(`/groups/settlements/${sId}/pay`);
          SpendlyApp.showToast({ type: 'success', title: 'Payment Marked', message: 'Marked as paid. Awaiting receiver confirmation.' });
          this.loadGroupDetail(groupId);
        } catch (err) {
          SpendlyApp.showToast({ type: 'error', title: 'Error', message: err.message });
        }
      };
    });

    document.querySelectorAll('.confirm-received-btn').forEach(btn => {
      btn.onclick = async () => {
        const sId = btn.getAttribute('data-settlement-id');
        try {
          await SpendlyAPI.post(`/groups/settlements/${sId}/confirm`);
          SpendlyApp.showToast({ type: 'success', title: 'Confirmed', message: 'Payment confirmed. Settlement completed!' });
          this.loadGroupDetail(groupId);
        } catch (err) {
          SpendlyApp.showToast({ type: 'error', title: 'Error', message: err.message });
        }
      };
    });

    document.querySelectorAll('.dispute-btn').forEach(btn => {
      btn.onclick = async () => {
        const sId = btn.getAttribute('data-settlement-id');
        try {
          await SpendlyAPI.post(`/groups/settlements/${sId}/dispute`);
          SpendlyApp.showToast({ type: 'warning', title: 'Payment Disputed', message: 'Status reverted to pending.' });
          this.loadGroupDetail(groupId);
        } catch (err) {
          SpendlyApp.showToast({ type: 'error', title: 'Error', message: err.message });
        }
      };
    });
  },

  showCreateGroupModal() {
    SpendlyApp.showModal({
      title: 'Create Shared Group',
      renderBody: () => `
        <div class="form-group">
          <label class="form-label" for="new-group-name">Group Name</label>
          <input type="text" id="new-group-name" class="form-input" placeholder="e.g. Flat 402 Roommates, Goa Trip" required />
        </div>
        <div class="form-group">
          <label class="form-label" for="invite-usernames">Invite Members (Optional)</label>
          <input type="text" id="invite-usernames" class="form-input" placeholder="Comma separated usernames, e.g. rahul456, priya_99" />
          <span style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
            Maximum 50 total members. Invitations will be sent for members to accept.
          </span>
        </div>
      `,
      confirmText: 'Create Group',
      onConfirm: async (close) => {
        const name = document.getElementById('new-group-name').value.trim();
        const rawUsernames = document.getElementById('invite-usernames').value;
        const invitedUsernames = rawUsernames ? rawUsernames.split(',').map(u => u.trim()).filter(Boolean) : [];

        if (!name) {
          SpendlyApp.showToast({ type: 'error', title: 'Validation', message: 'Group name is required.' });
          return;
        }

        try {
          const res = await SpendlyAPI.post('/groups', { name, invitedUsernames });
          SpendlyApp.showToast({ type: 'success', title: 'Group Created', message: `Group "${name}" created.` });
          close();
          window.location.hash = `#/split-it/${res.group.id}`;
        } catch (err) {
          SpendlyApp.showToast({ type: 'error', title: 'Error', message: err.message });
        }
      }
    });
  },

  showAddGroupExpenseModal(groupId) {
    SpendlyApp.showModal({
      title: 'Add Group Expense',
      renderBody: () => `
        <div class="form-group">
          <label class="form-label" for="grp-exp-desc">Description</label>
          <input type="text" id="grp-exp-desc" class="form-input" placeholder="e.g. Cafe, Electricity bill, Dinner" required />
        </div>
        <div class="form-group">
          <label class="form-label" for="grp-exp-amount">Amount</label>
          <div class="currency-input-wrapper">
            <span class="currency-prefix">₹</span>
            <input type="number" id="grp-exp-amount" class="form-input" placeholder="250.00" min="0.01" step="0.01" required />
          </div>
        </div>
      `,
      confirmText: 'Add to Group',
      onConfirm: async (close) => {
        const description = document.getElementById('grp-exp-desc').value.trim();
        const amount = parseFloat(document.getElementById('grp-exp-amount').value);

        if (!description || isNaN(amount) || amount <= 0) {
          SpendlyApp.showToast({ type: 'error', title: 'Validation', message: 'Please provide description and valid amount.' });
          return;
        }

        try {
          await SpendlyAPI.post(`/groups/${groupId}/expenses`, { description, amount });
          SpendlyApp.showToast({ type: 'success', title: 'Added', message: 'Expense added to group.' });
          close();
          this.loadGroupDetail(groupId);
        } catch (err) {
          SpendlyApp.showToast({ type: 'error', title: 'Error', message: err.message });
        }
      }
    });
  },

  showEditGroupExpenseModal(groupId, expId, currentDesc, currentAmount) {
    SpendlyApp.showModal({
      title: 'Edit Group Expense',
      renderBody: () => `
        <div class="form-group">
          <label class="form-label" for="edit-grp-desc">Description</label>
          <input type="text" id="edit-grp-desc" class="form-input" value="${this.escapeHtml(currentDesc)}" required />
        </div>
        <div class="form-group">
          <label class="form-label" for="edit-grp-amount">Amount</label>
          <div class="currency-input-wrapper">
            <span class="currency-prefix">₹</span>
            <input type="number" id="edit-grp-amount" class="form-input" value="${currentAmount}" min="0.01" step="0.01" required />
          </div>
        </div>
      `,
      confirmText: 'Save Changes',
      onConfirm: async (close) => {
        const description = document.getElementById('edit-grp-desc').value.trim();
        const amount = parseFloat(document.getElementById('edit-grp-amount').value);

        try {
          await SpendlyAPI.put(`/groups/${groupId}/expenses/${expId}`, { description, amount });
          SpendlyApp.showToast({ type: 'success', title: 'Updated', message: 'Expense updated.' });
          close();
          this.loadGroupDetail(groupId);
        } catch (err) {
          SpendlyApp.showToast({ type: 'error', title: 'Error', message: err.message });
        }
      }
    });
  },

  showInviteMemberModal(groupId) {
    SpendlyApp.showModal({
      title: 'Invite Member by Username',
      renderBody: () => `
        <div class="form-group">
          <label class="form-label" for="invite-uname-input">Spendly Username</label>
          <input type="text" id="invite-uname-input" class="form-input" placeholder="Search by username, e.g. priya_99" required />
          <div id="user-search-results" style="margin-top: 8px; display: flex; flex-direction: column; gap: 4px;"></div>
        </div>
        <p style="font-size: 12px; color: var(--text-muted);">
          Note: Membership changes can only take place when billing is completed (Section 43).
        </p>
      `,
      confirmText: 'Send Invitation',
      onConfirm: async (close) => {
        const username = document.getElementById('invite-uname-input').value.trim();
        if (!username) {
          SpendlyApp.showToast({ type: 'error', title: 'Validation', message: 'Please enter a username.' });
          return;
        }

        try {
          await SpendlyAPI.post(`/groups/${groupId}/invite`, { username });
          SpendlyApp.showToast({ type: 'success', title: 'Invitation Sent', message: `Invitation sent to @${username}.` });
          close();
        } catch (err) {
          SpendlyApp.showToast({ type: 'error', title: 'Invitation Failed', message: err.message });
        }
      }
    });

    // Auto-search usernames
    setTimeout(() => {
      const input = document.getElementById('invite-uname-input');
      if (input) {
        let timeout;
        input.oninput = () => {
          clearTimeout(timeout);
          const q = input.value.trim();
          if (q.length < 2) return;
          timeout = setTimeout(async () => {
            try {
              const res = await SpendlyAPI.get(`/auth/search-users?q=${encodeURIComponent(q)}`);
              const resultsContainer = document.getElementById('user-search-results');
              if (res.users && res.users.length > 0) {
                resultsContainer.innerHTML = res.users.map(u => `
                  <div style="padding: 6px 10px; background: var(--bg-primary); border-radius: var(--radius-sm); cursor: pointer; display: flex; justify-content: space-between; font-size: 13px;" onclick="document.getElementById('invite-uname-input').value = '${u.username}'; document.getElementById('user-search-results').innerHTML = '';">
                    <span><strong>@${u.username}</strong> (${u.display_name || ''})</span>
                    <span style="color: var(--accent-primary);">Select</span>
                  </div>
                `).join('');
              }
            } catch (e) {}
          }, 250);
        };
      }
    }, 100);
  },

  showSetTemporaryNameModal(groupId, userId, currentTempName) {
    SpendlyApp.showModal({
      title: 'Assign Temporary Display Name',
      renderBody: () => `
        <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 14px;">
          Temporary names are group-specific (e.g. "Roommate 1", "Driver", "Treasurer") and do not change the user's global Spendly username.
        </p>
        <div class="form-group">
          <label class="form-label" for="temp-name-input">Temporary Name</label>
          <input type="text" id="temp-name-input" class="form-input" value="${this.escapeHtml(currentTempName)}" placeholder="e.g. Roommate 1" />
        </div>
      `,
      confirmText: 'Save Temporary Name',
      onConfirm: async (close) => {
        const temporaryName = document.getElementById('temp-name-input').value.trim();
        try {
          await SpendlyAPI.put(`/groups/${groupId}/members/${userId}/temporary-name`, { temporaryName });
          SpendlyApp.showToast({ type: 'success', title: 'Saved', message: 'Temporary name assigned.' });
          close();
          this.loadGroupDetail(groupId);
        } catch (err) {
          SpendlyApp.showToast({ type: 'error', title: 'Error', message: err.message });
        }
      }
    });
  },

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
};

window.SpendlySplitItView = SpendlySplitItView;
