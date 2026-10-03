/**
 * Spendly Bill View
 * Displays immutable historical bills for Personal and Group expenses.
 * Allows viewing complete snapshot and hiding individual views without corrupting database records.
 * Export is strictly prohibited per Section 49.
 */
const SpendlyBillView = {
  activeTab: 'personal', // 'personal' | 'group'
  billsData: { personalBills: [], groupBills: [] },

  async render() {
    const container = document.getElementById('main-view-container');
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Billing History</h1>
          <p class="page-subtitle">Immutable permanent records of your completed cycles</p>
        </div>
      </div>

      <div class="bills-tabs">
        <button class="filter-btn ${this.activeTab === 'personal' ? 'active' : ''}" id="tab-personal-bills">
          💼 Personal Bills
        </button>
        <button class="filter-btn ${this.activeTab === 'group' ? 'active' : ''}" id="tab-group-bills">
          👥 Group Bills
        </button>
      </div>

      <div id="bills-content-container">
        <div style="text-align: center; padding: 40px; color: var(--text-muted);">
          Loading your bills...
        </div>
      </div>
    `;

    this.attachTabEvents();
    await this.loadBills();
  },

  attachTabEvents() {
    const tabPersonal = document.getElementById('tab-personal-bills');
    const tabGroup = document.getElementById('tab-group-bills');

    if (tabPersonal) {
      tabPersonal.onclick = () => {
        this.activeTab = 'personal';
        tabPersonal.classList.add('active');
        if (tabGroup) tabGroup.classList.remove('active');
        this.renderBillsContent();
      };
    }

    if (tabGroup) {
      tabGroup.onclick = () => {
        this.activeTab = 'group';
        tabGroup.classList.add('active');
        if (tabPersonal) tabPersonal.classList.remove('active');
        this.renderBillsContent();
      };
    }
  },

  async loadBills() {
    try {
      this.billsData = await SpendlyAPI.get('/bills');
      this.renderBillsContent();
    } catch (err) {
      document.getElementById('bills-content-container').innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title" style="color: var(--accent-danger);">Failed to load bills</div>
          <p class="empty-state-text">${err.message}</p>
        </div>
      `;
    }
  },

  renderBillsContent() {
    const container = document.getElementById('bills-content-container');
    const { personalBills, groupBills } = this.billsData;

    if (this.activeTab === 'personal') {
      if (personalBills.length === 0) {
        container.innerHTML = `
          <div class="card empty-state">
            <div class="empty-state-icon">📜</div>
            <div class="empty-state-title">No Personal Bills Yet</div>
            <p class="empty-state-text">When you complete an active cycle in Own Expenses and click "Bill This Cycle", an immutable bill record will be permanently preserved here.</p>
          </div>
        `;
        return;
      }

      container.innerHTML = `
        <div class="bills-grid">
          ${personalBills.map(b => `
            <div class="bill-receipt-card">
              <div class="bill-receipt-header">
                <div>
                  <div class="bill-receipt-title">Personal Cycle #${b.cycleNumber}</div>
                  <span class="bill-date">${SpendlyStore.formatDateTime(b.createdAt)}</span>
                </div>
                <span class="badge badge-emerald">Permanent Record</span>
              </div>

              <div class="bill-totals-row">
                <span>Total Spent</span>
                <span style="font-family: var(--font-heading); font-size: 18px; color: var(--text-primary);">
                  ${SpendlyStore.formatINR(b.totalSpent)}
                </span>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 13px;">
                <div>
                  <span style="color: var(--text-muted);">Allocated Budget:</span>
                  <div><strong>${SpendlyStore.formatINR(b.totalSetAmount)}</strong></div>
                </div>
                <div>
                  <span style="color: var(--text-muted);">${b.totalOverspent > 0 ? 'Overspent:' : 'Remaining:'}</span>
                  <div>
                    <strong style="color: ${b.totalOverspent > 0 ? 'var(--accent-danger)' : 'var(--accent-primary)'};">
                      ${b.totalOverspent > 0 ? SpendlyStore.formatINR(b.totalOverspent) : SpendlyStore.formatINR(b.totalRemaining)}
                    </strong>
                  </div>
                </div>
              </div>

              <div style="font-size: 12px; color: var(--text-muted);">
                ${b.entryCount} spending transaction(s) recorded
              </div>

              <div style="display: flex; gap: 8px; margin-top: auto; padding-top: 10px; border-top: 1px solid var(--border-subtle);">
                <button class="btn btn-secondary btn-sm view-personal-bill-btn" data-bill-id="${b.id}" style="flex: 1;">
                  View Full Receipt
                </button>
                <button class="btn btn-secondary btn-sm delete-bill-btn" data-bill-type="personal" data-bill-id="${b.id}" title="Remove from My View">
                  <svg viewBox="0 0 24 24" fill="none"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke="currentColor"/></svg>
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    } else {
      if (groupBills.length === 0) {
        container.innerHTML = `
          <div class="card empty-state">
            <div class="empty-state-icon">📜</div>
            <div class="empty-state-title">No Group Bills Yet</div>
            <p class="empty-state-text">When group admins bill a cycle in Split It, permanent group bills with settlement history are archived here.</p>
          </div>
        `;
        return;
      }

      container.innerHTML = `
        <div class="bills-grid">
          ${groupBills.map(b => `
            <div class="bill-receipt-card">
              <div class="bill-receipt-header">
                <div>
                  <div class="bill-receipt-title">${this.escapeHtml(b.groupName)}</div>
                  <span class="bill-date">Cycle #${b.cycleNumber} &bull; ${SpendlyStore.formatDateTime(b.createdAt)}</span>
                </div>
                <span class="badge badge-cyan">${b.memberCount} Members</span>
              </div>

              <div class="bill-totals-row">
                <span>Total Group Bill</span>
                <span style="font-family: var(--font-heading); font-size: 18px; color: var(--text-primary);">
                  ${SpendlyStore.formatINR(b.totalSpent)}
                </span>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 13px;">
                <div>
                  <span style="color: var(--text-muted);">Equal Share:</span>
                  <div><strong>${SpendlyStore.formatINR(b.equalShare)}</strong></div>
                </div>
                <div>
                  <span style="color: var(--text-muted);">Your Spending:</span>
                  <div><strong>${SpendlyStore.formatINR(b.userSpent)}</strong></div>
                </div>
              </div>

              <div style="display: flex; gap: 8px; margin-top: auto; padding-top: 10px; border-top: 1px solid var(--border-subtle);">
                <button class="btn btn-secondary btn-sm view-group-bill-btn" data-bill-id="${b.id}" style="flex: 1;">
                  View Full Bill & Settlements
                </button>
                <button class="btn btn-secondary btn-sm delete-bill-btn" data-bill-type="group" data-bill-id="${b.id}" title="Remove from My View">
                  <svg viewBox="0 0 24 24" fill="none"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke="currentColor"/></svg>
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    this.attachBillActions();
  },

  attachBillActions() {
    // View Personal Bill
    document.querySelectorAll('.view-personal-bill-btn').forEach(btn => {
      btn.onclick = () => {
        const billId = btn.getAttribute('data-bill-id');
        const bill = this.billsData.personalBills.find(b => b.id === billId);
        if (bill) this.showPersonalBillModal(bill);
      };
    });

    // View Group Bill
    document.querySelectorAll('.view-group-bill-btn').forEach(btn => {
      btn.onclick = async () => {
        const billId = btn.getAttribute('data-bill-id');
        try {
          const details = await SpendlyAPI.get(`/bills/group/${billId}`);
          this.showGroupBillModal(details);
        } catch (err) {
          SpendlyApp.showToast({ type: 'error', title: 'Error', message: err.message });
        }
      };
    });

    // Hide / Remove Bill from user view
    document.querySelectorAll('.delete-bill-btn').forEach(btn => {
      btn.onclick = () => {
        const billId = btn.getAttribute('data-bill-id');
        const billType = btn.getAttribute('data-bill-type');

        SpendlyApp.showConfirmModal({
          title: 'Remove Bill from View?',
          message: 'This will remove this bill record from your personal list. For shared group bills, this will not affect other members or historical accounting.',
          confirmText: 'Remove',
          isDanger: true,
          onConfirm: async (close) => {
            try {
              await SpendlyAPI.delete(`/bills/${billType}/${billId}`);
              SpendlyApp.showToast({ type: 'success', title: 'Removed', message: 'Bill removed from your view.' });
              close();
              this.loadBills();
            } catch (err) {
              SpendlyApp.showToast({ type: 'error', title: 'Error', message: err.message });
            }
          }
        });
      };
    });
  },

  showPersonalBillModal(bill) {
    const s = bill.snapshot;

    SpendlyApp.showModal({
      title: `Personal Bill — Cycle #${bill.cycleNumber}`,
      renderBody: () => `
        <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 16px;">
          Billed on <strong>${SpendlyStore.formatDateTime(s.billedAt)}</strong> &bull; User: <strong>@${s.userSnapshot.username}</strong>
        </div>

        <div class="bill-totals-row" style="margin-bottom: 18px;">
          <span>Total Cycle Spending</span>
          <span style="font-family: var(--font-heading); font-size: 20px; font-weight: 700; color: var(--accent-primary);">
            ${SpendlyStore.formatINR(s.totals.totalSpent)}
          </span>
        </div>

        <h4 style="font-size: 14px; font-weight: 700; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 10px;">
          Expense Heads Breakdown
        </h4>

        <div style="display: flex; flex-direction: column; gap: 12px;">
          ${s.heads.map(h => `
            <div style="background: var(--bg-primary); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 12px 14px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <strong>${this.escapeHtml(h.name)}</strong>
                <span style="font-family: var(--font-heading); font-weight: 700;">${SpendlyStore.formatINR(h.spent)}</span>
              </div>
              <div style="font-size: 12px; color: var(--text-muted); display: flex; justify-content: space-between;">
                <span>Budget: ${SpendlyStore.formatINR(h.setAmount)}</span>
                <span>${h.overspent > 0 ? `<span style="color: var(--accent-danger);">Overspent by ${SpendlyStore.formatINR(h.overspent)}</span>` : `<span style="color: var(--accent-primary);">Remaining: ${SpendlyStore.formatINR(h.remaining)}</span>`}</span>
              </div>

              ${h.items && h.items.length > 0 ? `
                <div style="margin-top: 10px; border-top: 1px dashed var(--border-card); padding-top: 8px; display: flex; flex-direction: column; gap: 4px;">
                  ${h.items.map(it => `
                    <div style="display: flex; justify-content: space-between; font-size: 12px; color: var(--text-secondary);">
                      <span>${this.escapeHtml(it.description)}</span>
                      <span>${SpendlyStore.formatINR(it.amount)}</span>
                    </div>
                  `).join('')}
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      `,
      confirmText: 'Close',
      onConfirm: (close) => close()
    });
  },

  showGroupBillModal(details) {
    const s = details.snapshot;
    const settlements = details.settlements || [];

    SpendlyApp.showModal({
      title: `Group Bill — ${s.groupName}`,
      renderBody: () => `
        <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 16px;">
          Cycle #${s.cycleNumber} &bull; Billed on <strong>${SpendlyStore.formatDateTime(s.billedAt)}</strong> &bull; ${s.memberCount} Members
        </div>

        <div class="bill-totals-row" style="margin-bottom: 18px;">
          <div>
            <span style="font-size: 12px; color: var(--text-muted); display: block;">Total Group Bill</span>
            <span style="font-family: var(--font-heading); font-size: 20px; font-weight: 700; color: var(--text-primary);">
              ${SpendlyStore.formatINR(s.totalSpent)}
            </span>
          </div>
          <div style="text-align: right;">
            <span style="font-size: 12px; color: var(--text-muted); display: block;">Equal Share / Person</span>
            <span style="font-family: var(--font-heading); font-size: 20px; font-weight: 700; color: var(--accent-cyan);">
              ${SpendlyStore.formatINR(s.equalShare)}
            </span>
          </div>
        </div>

        <h4 style="font-size: 14px; font-weight: 700; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 10px;">
          Member Spending & Differences
        </h4>

        <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px;">
          ${s.members.map(m => {
            const diff = m.spent - m.share;
            return `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--bg-primary); border-radius: var(--radius-md); font-size: 13px;">
                <div>
                  <strong>${this.escapeHtml(m.temporaryName || m.displayName || m.username)}</strong>
                  <span style="font-size: 11px; color: var(--text-muted);"> (@${this.escapeHtml(m.username)})</span>
                </div>
                <div style="text-align: right;">
                  <div>Spent: <strong>${SpendlyStore.formatINR(m.spent)}</strong></div>
                  <span style="font-size: 11px; font-weight: 600; color: ${diff >= 0 ? 'var(--accent-primary)' : 'var(--accent-danger)'};">
                    ${diff >= 0 ? `+${SpendlyStore.formatINR(diff)}` : `-${SpendlyStore.formatINR(-diff)}`}
                  </span>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <h4 style="font-size: 14px; font-weight: 700; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 10px;">
          Final Settlement Instructions
        </h4>

        ${settlements.length === 0 ? `
          <p style="font-size: 13px; color: var(--text-muted);">All members had equal spending. No settlements required.</p>
        ` : `
          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${settlements.map(settle => {
              const payer = settle.payer_name || settle.payer_username;
              const receiver = settle.receiver_name || settle.receiver_username;
              return `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--bg-primary); border-radius: var(--radius-md); font-size: 13px;">
                  <div>
                    <strong>${this.escapeHtml(payer)}</strong>
                    <span style="color: var(--accent-primary); font-weight: 700;"> &rarr; </span>
                    <strong>${this.escapeHtml(receiver)}</strong>
                  </div>
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="font-family: var(--font-heading); font-weight: 700;">${SpendlyStore.formatINR(settle.amount)}</span>
                    <span class="badge ${settle.status === 'completed' ? 'badge-emerald' : 'badge-amber'}" style="font-size: 11px;">
                      ${settle.status === 'completed' ? '✓ Completed' : settle.status === 'pending_confirmation' ? '⏳ Pending' : 'Pending'}
                    </span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      `,
      confirmText: 'Close',
      onConfirm: (close) => close()
    });
  },

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
};

window.SpendlyBillView = SpendlyBillView;
