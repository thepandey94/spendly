/**
 * Spendly Own Expenses View (Personal Expense Engine)
 * Implements user-created expense heads, spending entries, real-time calculations,
 * 10,000 entry limit, atomic cycle billing, and start-new-cycle.
 */
const SpendlyOwnExpensesView = {
  dashboardData: null,

  async render() {
    const container = document.getElementById('main-view-container');
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Own Expenses</h1>
          <p class="page-subtitle">Track your personal budgets and spending with deterministic billing cycles</p>
        </div>
        <div style="display: flex; gap: 10px;">
          <button class="btn btn-secondary" id="add-head-btn">
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor"/></svg>
            Add Expense Head
          </button>
          <button class="btn btn-primary" id="bill-cycle-btn">
            <svg viewBox="0 0 24 24" fill="none"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor"/></svg>
            Bill This Cycle
          </button>
        </div>
      </div>

      <div id="own-expenses-content">
        <div style="text-align: center; padding: 40px; color: var(--text-muted);">
          Loading your personal expenses...
        </div>
      </div>
    `;

    await this.loadDashboard();
    this.attachHeaderActions();
  },

  async loadDashboard() {
    try {
      this.dashboardData = await SpendlyAPI.get('/personal/dashboard');
      this.renderDashboardContent();
    } catch (err) {
      document.getElementById('own-expenses-content').innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title" style="color: var(--accent-danger);">Failed to load dashboard</div>
          <p class="empty-state-text">${err.message}</p>
          <button class="btn btn-secondary" onclick="SpendlyOwnExpensesView.loadDashboard()">Retry</button>
        </div>
      `;
    }
  },

  renderDashboardContent() {
    const container = document.getElementById('own-expenses-content');
    const { hasActiveCycle, cycle, lastBilledCycle, heads, totals } = this.dashboardData;

    // If cycle was completed and waiting for new cycle
    if (!hasActiveCycle) {
      container.innerHTML = `
        <div class="card" style="border-left: 4px solid var(--accent-cyan); margin-bottom: 24px;">
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px;">
            <div>
              <h3 style="font-family: var(--font-heading); font-size: 20px; font-weight: 700; color: var(--text-primary);">
                Cycle #${lastBilledCycle ? lastBilledCycle.cycle_number : 1} Has Been Billed
              </h3>
              <p style="font-size: 14px; color: var(--text-secondary); margin-top: 4px;">
                All expenses in that cycle are permanently locked and saved in your Bill section. Start a fresh cycle to resume entering expenses.
              </p>
            </div>
            <button class="btn btn-primary btn-lg" id="start-new-cycle-btn">
              Start a New Cycle
            </button>
          </div>
        </div>
      `;

      const startBtn = document.getElementById('start-new-cycle-btn');
      if (startBtn) {
        startBtn.onclick = () => this.handleStartNewCycle();
      }

      // Hide "Bill This Cycle" and "Add Expense Head" while cycle is inactive
      const billBtn = document.getElementById('bill-cycle-btn');
      if (billBtn) billBtn.style.display = 'none';
      const addHeadBtn = document.getElementById('add-head-btn');
      if (addHeadBtn) addHeadBtn.style.display = 'none';

      return;
    }

    // Restore buttons visibility
    const billBtn = document.getElementById('bill-cycle-btn');
    if (billBtn) billBtn.style.display = 'inline-flex';
    const addHeadBtn = document.getElementById('add-head-btn');
    if (addHeadBtn) addHeadBtn.style.display = 'inline-flex';

    // Active Cycle View
    const totalSet = totals.totalSetAmount;
    const totalSpent = totals.totalSpent;
    const totalRem = totals.totalRemaining;
    const totalOver = totals.totalOverspent;
    const count = totals.entryCount;

    container.innerHTML = `
      <!-- Cycle Status Banner -->
      <div class="cycle-banner">
        <div class="cycle-info">
          <div class="cycle-badge">Active Cycle #${cycle.cycle_number}</div>
          <span class="cycle-entry-count">
            <strong>${count.toLocaleString()}</strong> of 10,000 entry limit
          </span>
        </div>
        <div style="font-size: 13px; color: var(--text-secondary);">
          Created: ${SpendlyStore.formatDateTime(cycle.created_at)}
        </div>
      </div>

      <!-- KPI Summary Cards -->
      <div class="kpi-grid">
        <div class="kpi-card">
          <span class="kpi-label">Total Budget (Set Amount)</span>
          <span class="kpi-value">${SpendlyStore.formatINR(totalSet)}</span>
          <span class="kpi-subtext">${heads.length} expense head(s)</span>
        </div>

        <div class="kpi-card ${totalSpent > totalSet ? 'danger' : ''}">
          <span class="kpi-label">Total Spent</span>
          <span class="kpi-value" style="color: ${totalSpent > totalSet ? 'var(--accent-danger)' : 'var(--text-primary)'};">
            ${SpendlyStore.formatINR(totalSpent)}
          </span>
          <span class="kpi-subtext">${totalSet > 0 ? ((totalSpent / totalSet) * 100).toFixed(1) : 0}% of budget</span>
        </div>

        <div class="kpi-card cyan">
          <span class="kpi-label">Remaining Balance</span>
          <span class="kpi-value" style="color: var(--accent-primary);">
            ${SpendlyStore.formatINR(totalRem)}
          </span>
          <span class="kpi-subtext">Within allocated budgets</span>
        </div>

        <div class="kpi-card ${totalOver > 0 ? 'danger' : ''}">
          <span class="kpi-label">Total Overspent</span>
          <span class="kpi-value" style="color: ${totalOver > 0 ? 'var(--accent-danger)' : 'var(--text-muted)'};">
            ${SpendlyStore.formatINR(totalOver)}
          </span>
          <span class="kpi-subtext">${totalOver > 0 ? 'Exceeded head budgets' : 'None overspent'}</span>
        </div>
      </div>

      <!-- Expense Heads Grid -->
      ${heads.length === 0 ? `
        <div class="card empty-state">
          <div class="empty-state-icon">💼</div>
          <div class="empty-state-title">No Expense Heads Created Yet</div>
          <p class="empty-state-text">Create your own expense heads (e.g. Rent, Groceries, Transport, Bills) to begin tracking your spending.</p>
          <button class="btn btn-primary" onclick="SpendlyOwnExpensesView.showAddHeadModal()">Create First Expense Head</button>
        </div>
      ` : `
        <div class="heads-grid">
          ${heads.map(h => this.renderHeadCard(h)).join('')}
        </div>
      `}
    `;

    this.attachHeadEvents();
  },

  renderHeadCard(head) {
    const percent = head.setAmount > 0 ? Math.min(Math.round((head.spent / head.setAmount) * 100), 100) : (head.spent > 0 ? 100 : 0);
    const isOverspent = head.spent > head.setAmount;

    return `
      <div class="head-card" data-head-id="${head.id}">
        <div class="head-header">
          <div class="head-name">${this.escapeHtml(head.name)}</div>
          <div class="head-actions">
            <button class="action-icon-btn edit-head-btn" title="Edit Head" data-head-id="${head.id}" data-name="${this.escapeHtml(head.name)}" data-amount="${head.setAmount / 100}">
              <svg viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor"/></svg>
            </button>
            <button class="action-icon-btn delete delete-head-btn" title="Delete Head" data-head-id="${head.id}">
              <svg viewBox="0 0 24 24" fill="none"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke="currentColor"/></svg>
            </button>
          </div>
        </div>

        <div class="head-body">
          <div class="head-amounts">
            <div class="amount-box">
              <span class="amount-box-label">Set Amount</span>
              <span class="amount-box-val">${SpendlyStore.formatINR(head.setAmount)}</span>
            </div>
            <div class="amount-box">
              <span class="amount-box-label">Total Spent</span>
              <span class="amount-box-val ${isOverspent ? 'rose' : ''}">${SpendlyStore.formatINR(head.spent)}</span>
            </div>
          </div>

          <!-- Progress Bar -->
          <div class="progress-track" title="${percent}% of budget spent">
            <div class="progress-fill ${isOverspent ? 'overspent' : ''}" style="width: ${percent}%;"></div>
          </div>

          <!-- Remaining / Overspent Pill -->
          <div style="display: flex; justify-content: space-between; align-items: center;">
            ${isOverspent ? `
              <span class="badge badge-rose">Overspent by ${SpendlyStore.formatINR(head.overspent)}</span>
            ` : `
              <span class="badge badge-emerald">Remaining: ${SpendlyStore.formatINR(head.remaining)}</span>
            `}
            <button class="btn btn-sm btn-primary add-entry-btn" data-head-id="${head.id}" data-head-name="${this.escapeHtml(head.name)}">
              <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor"/></svg>
              Add Entry
            </button>
          </div>

          <!-- Entries List -->
          <div class="entries-container">
            ${head.entries.length === 0 ? `
              <div style="text-align: center; padding: 16px; color: var(--text-muted); font-size: 13px;">
                No spending entries in this head yet.
              </div>
            ` : head.entries.map(e => `
              <div class="entry-row" data-entry-id="${e.id}">
                <div class="entry-left">
                  <span class="entry-desc">${this.escapeHtml(e.description)}</span>
                  <span class="entry-meta">${SpendlyStore.formatDateTime(e.created_at)}</span>
                </div>
                <div class="entry-right">
                  <span class="entry-amount">${SpendlyStore.formatINR(e.amount)}</span>
                  <button class="action-icon-btn edit-entry-btn" title="Edit Entry" data-entry-id="${e.id}" data-desc="${this.escapeHtml(e.description)}" data-amount="${e.amount / 100}">
                    <svg viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor"/></svg>
                  </button>
                  <button class="action-icon-btn delete delete-entry-btn" title="Delete Entry" data-entry-id="${e.id}">
                    <svg viewBox="0 0 24 24" fill="none"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke="currentColor"/></svg>
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  },

  attachHeaderActions() {
    const addHeadBtn = document.getElementById('add-head-btn');
    if (addHeadBtn) {
      addHeadBtn.onclick = () => this.showAddHeadModal();
    }

    const billCycleBtn = document.getElementById('bill-cycle-btn');
    if (billCycleBtn) {
      billCycleBtn.onclick = () => this.showBillingConfirmation();
    }
  },

  attachHeadEvents() {
    // Add Entry Buttons
    document.querySelectorAll('.add-entry-btn').forEach(btn => {
      btn.onclick = () => {
        const headId = btn.getAttribute('data-head-id');
        const headName = btn.getAttribute('data-head-name');
        this.showAddEntryModal(headId, headName);
      };
    });

    // Edit Head Buttons
    document.querySelectorAll('.edit-head-btn').forEach(btn => {
      btn.onclick = () => {
        const headId = btn.getAttribute('data-head-id');
        const name = btn.getAttribute('data-name');
        const amount = btn.getAttribute('data-amount');
        this.showEditHeadModal(headId, name, amount);
      };
    });

    // Delete Head Buttons
    document.querySelectorAll('.delete-head-btn').forEach(btn => {
      btn.onclick = () => {
        const headId = btn.getAttribute('data-head-id');
        SpendlyApp.showConfirmModal({
          title: 'Delete Expense Head?',
          message: 'Are you sure you want to delete this expense head and all of its spending entries? This action is permanent.',
          confirmText: 'Delete Head',
          isDanger: true,
          onConfirm: async (close) => {
            try {
              await SpendlyAPI.delete(`/personal/heads/${headId}`);
              SpendlyApp.showToast({ type: 'success', title: 'Deleted', message: 'Expense head deleted successfully.' });
              close();
              this.loadDashboard();
            } catch (err) {
              SpendlyApp.showToast({ type: 'error', title: 'Error', message: err.message });
            }
          }
        });
      };
    });

    // Edit Entry Buttons
    document.querySelectorAll('.edit-entry-btn').forEach(btn => {
      btn.onclick = () => {
        const entryId = btn.getAttribute('data-entry-id');
        const desc = btn.getAttribute('data-desc');
        const amount = btn.getAttribute('data-amount');
        this.showEditEntryModal(entryId, desc, amount);
      };
    });

    // Delete Entry Buttons
    document.querySelectorAll('.delete-entry-btn').forEach(btn => {
      btn.onclick = () => {
        const entryId = btn.getAttribute('data-entry-id');
        SpendlyApp.showConfirmModal({
          title: 'Delete Spending Entry?',
          message: 'Are you sure you want to permanently delete this spending entry?',
          confirmText: 'Delete Entry',
          isDanger: true,
          onConfirm: async (close) => {
            try {
              await SpendlyAPI.delete(`/personal/expenses/${entryId}`);
              SpendlyApp.showToast({ type: 'success', title: 'Deleted', message: 'Entry removed successfully.' });
              close();
              this.loadDashboard();
            } catch (err) {
              SpendlyApp.showToast({ type: 'error', title: 'Error', message: err.message });
            }
          }
        });
      };
    });
  },

  showAddHeadModal() {
    SpendlyApp.showModal({
      title: 'Add Expense Head',
      renderBody: () => `
        <div class="form-group">
          <label class="form-label" for="head-name-input">Expense Head Name</label>
          <input type="text" id="head-name-input" class="form-input" placeholder="e.g. Rent, Kirana, Transport, Groceries" required />
        </div>
        <div class="form-group">
          <label class="form-label" for="head-amount-input">Allocated Budget (Set Amount)</label>
          <div class="currency-input-wrapper">
            <span class="currency-prefix">₹</span>
            <input type="number" id="head-amount-input" class="form-input" placeholder="5000.00" min="0" step="0.01" required />
          </div>
        </div>
      `,
      confirmText: 'Create Head',
      onConfirm: async (close) => {
        const name = document.getElementById('head-name-input').value.trim();
        const setAmount = parseFloat(document.getElementById('head-amount-input').value);

        if (!name) {
          SpendlyApp.showToast({ type: 'error', title: 'Validation', message: 'Please provide an expense head name.' });
          return;
        }

        try {
          await SpendlyAPI.post('/personal/heads', { name, setAmount: isNaN(setAmount) ? 0 : setAmount });
          SpendlyApp.showToast({ type: 'success', title: 'Created', message: `Expense head "${name}" created.` });
          close();
          this.loadDashboard();
        } catch (err) {
          SpendlyApp.showToast({ type: 'error', title: 'Error', message: err.message });
        }
      }
    });
  },

  showEditHeadModal(headId, currentName, currentAmount) {
    SpendlyApp.showModal({
      title: 'Edit Expense Head',
      renderBody: () => `
        <div class="form-group">
          <label class="form-label" for="edit-head-name">Expense Head Name</label>
          <input type="text" id="edit-head-name" class="form-input" value="${this.escapeHtml(currentName)}" required />
        </div>
        <div class="form-group">
          <label class="form-label" for="edit-head-amount">Allocated Budget (Set Amount)</label>
          <div class="currency-input-wrapper">
            <span class="currency-prefix">₹</span>
            <input type="number" id="edit-head-amount" class="form-input" value="${currentAmount}" min="0" step="0.01" required />
          </div>
        </div>
      `,
      confirmText: 'Save Changes',
      onConfirm: async (close) => {
        const name = document.getElementById('edit-head-name').value.trim();
        const setAmount = parseFloat(document.getElementById('edit-head-amount').value);

        try {
          await SpendlyAPI.put(`/personal/heads/${headId}`, { name, setAmount: isNaN(setAmount) ? 0 : setAmount });
          SpendlyApp.showToast({ type: 'success', title: 'Saved', message: 'Expense head updated.' });
          close();
          this.loadDashboard();
        } catch (err) {
          SpendlyApp.showToast({ type: 'error', title: 'Error', message: err.message });
        }
      }
    });
  },

  showAddEntryModal(headId, headName) {
    SpendlyApp.showModal({
      title: `Add Spending: ${headName}`,
      renderBody: () => `
        <div class="form-group">
          <label class="form-label" for="entry-desc-input">Description / Store / Item</label>
          <input type="text" id="entry-desc-input" class="form-input" placeholder="e.g. Landlord, Market purchase, Repair" required />
        </div>
        <div class="form-group">
          <label class="form-label" for="entry-amount-input">Amount Spent</label>
          <div class="currency-input-wrapper">
            <span class="currency-prefix">₹</span>
            <input type="number" id="entry-amount-input" class="form-input" placeholder="250.00" min="0.01" step="0.01" required />
          </div>
          <span style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
            Negative amounts will automatically be converted to positive equivalents.
          </span>
        </div>
      `,
      confirmText: 'Record Spending',
      onConfirm: async (close) => {
        const description = document.getElementById('entry-desc-input').value.trim();
        const amount = parseFloat(document.getElementById('entry-amount-input').value);

        if (!description) {
          SpendlyApp.showToast({ type: 'error', title: 'Validation', message: 'Please enter a description.' });
          return;
        }
        if (isNaN(amount) || amount === 0) {
          SpendlyApp.showToast({ type: 'error', title: 'Validation', message: 'Please enter a valid amount.' });
          return;
        }

        try {
          await SpendlyAPI.post('/personal/expenses', { headId, description, amount });
          SpendlyApp.showToast({ type: 'success', title: 'Added', message: `Spending entry recorded in ${headName}.` });
          close();
          this.loadDashboard();
        } catch (err) {
          SpendlyApp.showToast({ type: 'error', title: 'Error', message: err.message });
        }
      }
    });
  },

  showEditEntryModal(entryId, currentDesc, currentAmount) {
    SpendlyApp.showModal({
      title: 'Edit Spending Entry',
      renderBody: () => `
        <div class="form-group">
          <label class="form-label" for="edit-entry-desc">Description</label>
          <input type="text" id="edit-entry-desc" class="form-input" value="${this.escapeHtml(currentDesc)}" required />
        </div>
        <div class="form-group">
          <label class="form-label" for="edit-entry-amount">Amount</label>
          <div class="currency-input-wrapper">
            <span class="currency-prefix">₹</span>
            <input type="number" id="edit-entry-amount" class="form-input" value="${currentAmount}" min="0.01" step="0.01" required />
          </div>
        </div>
      `,
      confirmText: 'Update Entry',
      onConfirm: async (close) => {
        const description = document.getElementById('edit-entry-desc').value.trim();
        const amount = parseFloat(document.getElementById('edit-entry-amount').value);

        try {
          await SpendlyAPI.put(`/personal/expenses/${entryId}`, { description, amount });
          SpendlyApp.showToast({ type: 'success', title: 'Updated', message: 'Spending entry updated.' });
          close();
          this.loadDashboard();
        } catch (err) {
          SpendlyApp.showToast({ type: 'error', title: 'Error', message: err.message });
        }
      }
    });
  },

  showBillingConfirmation() {
    SpendlyApp.showConfirmModal({
      title: 'Generate Permanent Bill?',
      message: 'Generating billing will lock this cycle permanently. Current expenses cannot be edited or deleted once billed, and an immutable bill will be saved in your Bill section.',
      confirmText: 'Bill & Lock Cycle',
      isDanger: false,
      onConfirm: async (close) => {
        try {
          const res = await SpendlyAPI.post('/personal/billing');
          SpendlyApp.showToast({ type: 'success', title: 'Cycle Billed', message: 'Permanent bill created successfully!' });
          close();
          // Reload dashboard (will show start-new-cycle prompt)
          this.loadDashboard();
        } catch (err) {
          SpendlyApp.showToast({ type: 'error', title: 'Billing Failed', message: err.message });
        }
      }
    });
  },

  async handleStartNewCycle() {
    try {
      await SpendlyAPI.post('/personal/start-new-cycle');
      SpendlyApp.showToast({ type: 'success', title: 'Fresh Cycle Started', message: 'Your new personal cycle is active.' });
      this.loadDashboard();
    } catch (err) {
      SpendlyApp.showToast({ type: 'error', title: 'Error', message: err.message });
    }
  },

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
};

window.SpendlyOwnExpensesView = SpendlyOwnExpensesView;
