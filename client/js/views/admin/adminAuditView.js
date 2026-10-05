/**
 * Spendly Admin Audit View
 * Transparent, immutable inspection of administrative actions and access logs.
 */
const SpendlyAdminAuditView = {
  currentPage: 1,
  limit: 25,
  actionFilter: '',
  searchQuery: '',
  searchDebounce: null,

  async render() {
    const loadingHtml = `
      <div style="text-align: center; padding: 60px 20px; color: var(--text-muted);">
        <div class="logo-icon" style="margin: 0 auto 16px auto; animation: pulse 1.5s infinite;"></div>
        <p style="font-size: 15px; font-weight: 500;">Retrieving immutable administrative audit logs...</p>
      </div>
    `;

    SpendlyAdmin.renderShell('audit', loadingHtml);
    await this.fetchAndRender();
  },

  async fetchAndRender() {
    try {
      const queryParams = new URLSearchParams({
        page: this.currentPage,
        limit: this.limit,
        action: this.actionFilter,
        search: this.searchQuery
      });

      const data = await SpendlyAdmin.request(`/audit-logs?${queryParams.toString()}`);
      this.renderContent(data);
    } catch (err) {
      const errorHtml = `
        <div class="empty-state" style="padding: 40px; text-align: center;">
          <h3 style="color: var(--accent-danger); margin-bottom: 8px;">Failed to load audit logs</h3>
          <p style="color: var(--text-secondary); margin-bottom: 20px;">${err.message}</p>
          <button class="btn btn-primary" onclick="SpendlyAdminAuditView.fetchAndRender()">Retry</button>
        </div>
      `;
      SpendlyAdmin.renderShell('audit', errorHtml);
    }
  },

  renderContent(data) {
    const { logs, pagination } = data;

    const contentHtml = `
      <div class="admin-header">
        <div>
          <h1 class="admin-title">Administrative Audit Trail</h1>
          <p class="admin-subtitle">
            Secure immutable audit logs tracking administrator queries, views, and security interventions
          </p>
        </div>
        <button class="btn btn-secondary" id="admin-refresh-audit-btn" style="padding: 9px 14px; font-size: 13px;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Refresh Logs
        </button>
      </div>

      <!-- Controls & Filter Toolbar -->
      <div class="admin-controls-bar">
        <div class="admin-search-wrapper">
          <svg class="admin-search-icon" viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <input 
            type="text" 
            id="admin-audit-search" 
            class="admin-search-input" 
            placeholder="Search by admin username or target ID..." 
            value="${SpendlyApp.escapeHtml(this.searchQuery)}"
          />
        </div>

        <div class="admin-filter-group">
          <select id="admin-audit-action" class="admin-select">
            <option value="" ${this.actionFilter === '' ? 'selected' : ''}>All Actions</option>
            <option value="admin_login" ${this.actionFilter === 'admin_login' ? 'selected' : ''}>admin_login</option>
            <option value="admin_login_failed" ${this.actionFilter === 'admin_login_failed' ? 'selected' : ''}>admin_login_failed</option>
            <option value="view_user_details" ${this.actionFilter === 'view_user_details' ? 'selected' : ''}>view_user_details</option>
            <option value="revoke_session" ${this.actionFilter === 'revoke_session' ? 'selected' : ''}>revoke_session</option>
            <option value="admin_logout" ${this.actionFilter === 'admin_logout' ? 'selected' : ''}>admin_logout</option>
          </select>
        </div>
      </div>

      <!-- Audit Logs Table -->
      <div class="admin-table-container">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Administrator</th>
              <th>Action</th>
              <th>Target Type</th>
              <th>Target ID</th>
              <th>Status</th>
              <th>Metadata</th>
            </tr>
          </thead>
          <tbody>
            ${logs.length === 0 ? `
              <tr>
                <td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">
                  No audit log records found matching your query.
                </td>
              </tr>
            ` : logs.map(l => {
              const isSuccess = l.status === 'success';
              return `
                <tr>
                  <td>${SpendlyStore.formatDateTime(l.createdAt)}</td>
                  <td>
                    <strong>@${SpendlyApp.escapeHtml(l.adminUsername)}</strong>
                  </td>
                  <td>
                    <span class="admin-badge" style="font-family: monospace; font-size: 11px;">
                      ${SpendlyApp.escapeHtml(l.action)}
                    </span>
                  </td>
                  <td>${l.targetType ? SpendlyApp.escapeHtml(l.targetType) : '-'}</td>
                  <td>
                    ${l.targetId ? `
                      <span style="font-family: monospace; font-size: 12px; color: var(--text-secondary);">
                        ${SpendlyApp.escapeHtml(l.targetId.slice(0, 16))}...
                      </span>
                    ` : '-'}
                  </td>
                  <td>
                    <span class="admin-status-badge ${isSuccess ? 'completed' : 'pending'}" style="${isSuccess ? '' : 'color: var(--accent-danger); background: var(--accent-danger-subtle);'}">
                      ${l.status}
                    </span>
                  </td>
                  <td>
                    ${l.details ? `
                      <details style="cursor: pointer; font-size: 11px; color: var(--accent-primary);">
                        <summary style="outline: none;">Inspect JSON</summary>
                        <pre style="margin-top: 6px; padding: 8px; background: var(--bg-secondary); border-radius: var(--radius-sm); font-size: 10px; max-width: 250px; overflow-x: auto;">${SpendlyApp.escapeHtml(JSON.stringify(l.details, null, 2))}</pre>
                      </details>
                    ` : '<span style="color: var(--text-muted);">-</span>'}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>

        <!-- Server-side Pagination Toolbar -->
        <div class="admin-pagination">
          <div>
            Showing ${logs.length > 0 ? (pagination.page - 1) * pagination.limit + 1 : 0} to ${Math.min(pagination.page * pagination.limit, pagination.total)} of ${pagination.total} records
          </div>
          <div class="admin-pagination-btns">
            <button 
              class="btn btn-sm btn-secondary" 
              id="admin-audit-prev-page" 
              ${pagination.page <= 1 ? 'disabled' : ''}
            >
              &larr; Previous
            </button>
            <span style="display: flex; align-items: center; padding: 0 10px; font-weight: 600;">
              ${pagination.page} / ${pagination.totalPages || 1}
            </span>
            <button 
              class="btn btn-sm btn-secondary" 
              id="admin-audit-next-page" 
              ${pagination.page >= pagination.totalPages ? 'disabled' : ''}
            >
              Next &rarr;
            </button>
          </div>
        </div>
      </div>
    `;

    SpendlyAdmin.renderShell('audit', contentHtml);
    this.attachEvents(pagination);
  },

  attachEvents(pagination) {
    const searchInput = document.getElementById('admin-audit-search');
    const actionSelect = document.getElementById('admin-audit-action');
    const refreshBtn = document.getElementById('admin-refresh-audit-btn');
    const prevBtn = document.getElementById('admin-audit-prev-page');
    const nextBtn = document.getElementById('admin-audit-next-page');

    if (searchInput) {
      searchInput.oninput = (e) => {
        clearTimeout(this.searchDebounce);
        this.searchDebounce = setTimeout(() => {
          this.searchQuery = e.target.value.trim();
          this.currentPage = 1;
          this.fetchAndRender();
        }, 300);
      };
    }

    if (actionSelect) {
      actionSelect.onchange = (e) => {
        this.actionFilter = e.target.value;
        this.currentPage = 1;
        this.fetchAndRender();
      };
    }

    if (refreshBtn) {
      refreshBtn.onclick = () => {
        this.fetchAndRender();
      };
    }

    if (prevBtn) {
      prevBtn.onclick = () => {
        if (this.currentPage > 1) {
          this.currentPage--;
          this.fetchAndRender();
        }
      };
    }

    if (nextBtn) {
      nextBtn.onclick = () => {
        if (this.currentPage < pagination.totalPages) {
          this.currentPage++;
          this.fetchAndRender();
        }
      };
    }
  }
};

window.SpendlyAdminAuditView = SpendlyAdminAuditView;
