/**
 * Spendly Analytics View
 * Provides numerical and table-based spending analysis with time filters.
 * Read-only aggregations per Section 50.
 */
const SpendlyAnalyticsView = {
  currentFilter: 'all', // 'all' | 'today' | 'month' | 'custom'
  customStart: null,
  customEnd: null,
  analyticsData: null,

  async render() {
    const container = document.getElementById('main-view-container');
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Spending Analytics</h1>
          <p class="page-subtitle">Detailed numerical breakdowns of your personal budgets and group contributions</p>
        </div>
      </div>

      <!-- Time Filter Bar -->
      <div class="filter-bar">
        <button class="filter-btn ${this.currentFilter === 'all' ? 'active' : ''}" data-filter="all">All Time</button>
        <button class="filter-btn ${this.currentFilter === 'today' ? 'active' : ''}" data-filter="today">Today</button>
        <button class="filter-btn ${this.currentFilter === 'month' ? 'active' : ''}" data-filter="month">This Month</button>
        <button class="filter-btn ${this.currentFilter === 'custom' ? 'active' : ''}" data-filter="custom">Custom Range</button>

        <div id="custom-date-inputs" style="display: ${this.currentFilter === 'custom' ? 'inline-flex' : 'none'}; gap: 8px; align-items: center; margin-left: 10px;">
          <input type="date" id="analytics-start-date" class="form-input" style="padding: 6px 10px; width: auto;" />
          <span style="color: var(--text-muted);">&rarr;</span>
          <input type="date" id="analytics-end-date" class="form-input" style="padding: 6px 10px; width: auto;" />
          <button class="btn btn-sm btn-primary" id="apply-custom-date-btn">Apply</button>
        </div>
      </div>

      <div id="analytics-content">
        <div style="text-align: center; padding: 40px; color: var(--text-muted);">
          Calculating spending metrics...
        </div>
      </div>
    `;

    this.attachFilterEvents();
    await this.loadAnalytics();
  },

  attachFilterEvents() {
    document.querySelectorAll('.filter-bar .filter-btn').forEach(btn => {
      btn.onclick = () => {
        const filter = btn.getAttribute('data-filter');
        this.currentFilter = filter;
        document.querySelectorAll('.filter-bar .filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const customInputs = document.getElementById('custom-date-inputs');
        if (filter === 'custom') {
          customInputs.style.display = 'inline-flex';
        } else {
          customInputs.style.display = 'none';
          this.loadAnalytics();
        }
      };
    });

    const applyBtn = document.getElementById('apply-custom-date-btn');
    if (applyBtn) {
      applyBtn.onclick = () => {
        const startVal = document.getElementById('analytics-start-date').value;
        const endVal = document.getElementById('analytics-end-date').value;
        if (!startVal || !endVal) {
          SpendlyApp.showToast({ type: 'error', title: 'Validation', message: 'Please select both start and end dates.' });
          return;
        }
        this.customStart = new Date(startVal).getTime();
        this.customEnd = new Date(endVal).getTime() + (24 * 60 * 60 * 1000 - 1);
        this.loadAnalytics();
      };
    }
  },

  async loadAnalytics() {
    try {
      let query = `filterType=${this.currentFilter}`;
      if (this.currentFilter === 'custom' && this.customStart && this.customEnd) {
        query += `&startDate=${this.customStart}&endDate=${this.customEnd}`;
      }

      this.analyticsData = await SpendlyAPI.get(`/analytics?${query}`);
      this.renderAnalyticsContent();
    } catch (err) {
      document.getElementById('analytics-content').innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title" style="color: var(--accent-danger);">Failed to calculate analytics</div>
          <p class="empty-state-text">${err.message}</p>
        </div>
      `;
    }
  },

  renderAnalyticsContent() {
    const container = document.getElementById('analytics-content');
    const { overall, personalHeads, groups } = this.analyticsData;

    container.innerHTML = `
      <!-- Overall KPI Cards (Section 50) -->
      <div class="kpi-grid">
        <div class="kpi-card">
          <span class="kpi-label">Total Combined Spending</span>
          <span class="kpi-value">${SpendlyStore.formatINR(overall.totalSpending)}</span>
          <span class="kpi-subtext">Personal + Group Spending</span>
        </div>

        <div class="kpi-card cyan">
          <span class="kpi-label">Personal Spending</span>
          <span class="kpi-value" style="color: var(--accent-cyan);">${SpendlyStore.formatINR(overall.personalSpending)}</span>
          <span class="kpi-subtext">Across personal expense heads</span>
        </div>

        <div class="kpi-card">
          <span class="kpi-label">Group Spending (Your Share)</span>
          <span class="kpi-value">${SpendlyStore.formatINR(overall.groupSpending)}</span>
          <span class="kpi-subtext">Your actual group contributions</span>
        </div>

        <div class="kpi-card ${overall.totalOwed > 0 ? 'danger' : ''}">
          <span class="kpi-label">Total Amount Owed</span>
          <span class="kpi-value" style="color: ${overall.totalOwed > 0 ? 'var(--accent-danger)' : 'var(--text-muted)'};">
            ${SpendlyStore.formatINR(overall.totalOwed)}
          </span>
          <span class="kpi-subtext">Pending settlements to pay</span>
        </div>

        <div class="kpi-card">
          <span class="kpi-label">Total Receivable</span>
          <span class="kpi-value" style="color: var(--accent-primary);">
            ${SpendlyStore.formatINR(overall.totalReceivable)}
          </span>
          <span class="kpi-subtext">Pending settlements to receive</span>
        </div>
      </div>

      <!-- Personal Expense Heads Breakdown Table -->
      <h2 style="font-family: var(--font-heading); font-size: 20px; font-weight: 700; margin-top: 32px; margin-bottom: 14px;">
        Personal Expense Heads
      </h2>

      ${personalHeads.length === 0 ? `
        <div class="card" style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 14px; margin-bottom: 30px;">
          No personal spending recorded in this time range.
        </div>
      ` : `
        <div class="table-responsive" style="margin-bottom: 30px;">
          <table class="spendly-table">
            <thead>
              <tr>
                <th>Expense Head</th>
                <th>Set Amount</th>
                <th>Total Spent</th>
                <th>Remaining</th>
                <th>Overspent</th>
                <th>Utilization</th>
              </tr>
            </thead>
            <tbody>
              ${personalHeads.map(h => {
                const util = h.setAmount > 0 ? ((h.spent / h.setAmount) * 100).toFixed(1) : 0;
                return `
                  <tr>
                    <td><strong>${this.escapeHtml(h.name)}</strong></td>
                    <td>${SpendlyStore.formatINR(h.setAmount)}</td>
                    <td style="font-weight: 700;">${SpendlyStore.formatINR(h.spent)}</td>
                    <td style="color: var(--accent-primary);">${SpendlyStore.formatINR(h.remaining)}</td>
                    <td style="color: ${h.overspent > 0 ? 'var(--accent-danger)' : 'inherit'};">
                      ${h.overspent > 0 ? SpendlyStore.formatINR(h.overspent) : '—'}
                    </td>
                    <td>
                      <span class="badge ${h.overspent > 0 ? 'badge-rose' : 'badge-emerald'}">
                        ${util}%
                      </span>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `}

      <!-- Group Analytics Table -->
      <h2 style="font-family: var(--font-heading); font-size: 20px; font-weight: 700; margin-top: 24px; margin-bottom: 14px;">
        Group Spending & Balances
      </h2>

      ${groups.length === 0 ? `
        <div class="card" style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 14px;">
          No group expenses found in this time range.
        </div>
      ` : `
        <div class="table-responsive">
          <table class="spendly-table">
            <thead>
              <tr>
                <th>Group Name</th>
                <th>Total Group Spending</th>
                <th>Your Contribution</th>
                <th>Your Equal Share</th>
                <th>Net Balance</th>
              </tr>
            </thead>
            <tbody>
              ${groups.map(g => `
                <tr>
                  <td><strong>${this.escapeHtml(g.groupName)}</strong></td>
                  <td>${SpendlyStore.formatINR(g.groupTotal)}</td>
                  <td style="font-weight: 700;">${SpendlyStore.formatINR(g.userContribution)}</td>
                  <td style="color: var(--accent-cyan);">${SpendlyStore.formatINR(g.userEqualShare)}</td>
                  <td>
                    <span class="badge ${g.netDifference > 0 ? 'badge-emerald' : g.netDifference < 0 ? 'badge-rose' : 'badge-secondary'}">
                      ${g.netDifference > 0 ? `+${SpendlyStore.formatINR(g.netDifference)}` : g.netDifference < 0 ? `-${SpendlyStore.formatINR(-g.netDifference)}` : 'Even'}
                    </span>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    `;
  },

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
};

window.SpendlyAnalyticsView = SpendlyAnalyticsView;
