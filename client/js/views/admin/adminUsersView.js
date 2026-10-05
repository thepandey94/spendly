/**
 * Spendly Admin Users View
 * Searchable, filterable, and paginated directory of registered platform users.
 */
const SpendlyAdminUsersView = {
  currentPage: 1,
  limit: 15,
  searchQuery: '',
  statusFilter: 'all',
  sortBy: 'created_at',
  sortOrder: 'desc',
  searchDebounce: null,

  async render() {
    const loadingHtml = `
      <div style="text-align: center; padding: 60px 20px; color: var(--text-muted);">
        <div class="logo-icon" style="margin: 0 auto 16px auto; animation: pulse 1.5s infinite;"></div>
        <p style="font-size: 15px; font-weight: 500;">Loading user directory...</p>
      </div>
    `;

    SpendlyAdmin.renderShell('users', loadingHtml);
    await this.fetchAndRender();
  },

  async fetchAndRender() {
    try {
      const queryParams = new URLSearchParams({
        page: this.currentPage,
        limit: this.limit,
        search: this.searchQuery,
        status: this.statusFilter,
        sortBy: this.sortBy,
        sortOrder: this.sortOrder
      });

      const data = await SpendlyAdmin.request(`/users?${queryParams.toString()}`);
      this.renderContent(data);
    } catch (err) {
      const errorHtml = `
        <div class="empty-state" style="padding: 40px; text-align: center;">
          <h3 style="color: var(--accent-danger); margin-bottom: 8px;">Failed to load users</h3>
          <p style="color: var(--text-secondary); margin-bottom: 20px;">${err.message}</p>
          <button class="btn btn-primary" onclick="SpendlyAdminUsersView.fetchAndRender()">Retry</button>
        </div>
      `;
      SpendlyAdmin.renderShell('users', errorHtml);
    }
  },

  renderContent(data) {
    const { users, pagination } = data;

    const contentHtml = `
      <div class="admin-header">
        <div>
          <h1 class="admin-title">User Management</h1>
          <p class="admin-subtitle">
            Showing ${pagination.total} registered platform accounts &bull; Page ${pagination.page} of ${pagination.totalPages || 1}
          </p>
        </div>
        <button class="btn btn-secondary" id="admin-refresh-users-btn" style="padding: 9px 14px; font-size: 13px;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Refresh
        </button>
      </div>

      <!-- Controls & Filter Toolbar -->
      <div class="admin-controls-bar">
        <div class="admin-search-wrapper">
          <svg class="admin-search-icon" viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <input 
            type="text" 
            id="admin-users-search" 
            class="admin-search-input" 
            placeholder="Search by username, email, or user ID..." 
            value="${SpendlyApp.escapeHtml(this.searchQuery)}"
          />
        </div>

        <div class="admin-filter-group">
          <select id="admin-users-status" class="admin-select">
            <option value="all" ${this.statusFilter === 'all' ? 'selected' : ''}>All Statuses</option>
            <option value="active" ${this.statusFilter === 'active' ? 'selected' : ''}>Active (Past 30d)</option>
            <option value="inactive" ${this.statusFilter === 'inactive' ? 'selected' : ''}>Inactive</option>
            <option value="recently_registered" ${this.statusFilter === 'recently_registered' ? 'selected' : ''}>New (Last 7d)</option>
            <option value="admin" ${this.statusFilter === 'admin' ? 'selected' : ''}>Admin Role</option>
          </select>

          <select id="admin-users-sort" class="admin-select">
            <option value="created_at:desc" ${this.sortBy === 'created_at' && this.sortOrder === 'desc' ? 'selected' : ''}>Joined (Newest)</option>
            <option value="created_at:asc" ${this.sortBy === 'created_at' && this.sortOrder === 'asc' ? 'selected' : ''}>Joined (Oldest)</option>
            <option value="last_active:desc" ${this.sortBy === 'last_active' && this.sortOrder === 'desc' ? 'selected' : ''}>Last Active</option>
            <option value="username:asc" ${this.sortBy === 'username' && this.sortOrder === 'asc' ? 'selected' : ''}>Username (A-Z)</option>
          </select>
        </div>
      </div>

      <!-- Users Table -->
      <div class="admin-table-container">
        <table class="admin-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Joined</th>
              <th>Last Active</th>
              <th>Groups</th>
              <th>Expenses</th>
              <th>Status</th>
              <th style="text-align: right;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${users.length === 0 ? `
              <tr>
                <td colspan="8" style="text-align: center; padding: 40px; color: var(--text-muted);">
                  No user accounts found matching your query.
                </td>
              </tr>
            ` : users.map(u => {
              const avatarLetter = (u.displayName || u.username || 'U')[0].toUpperCase();
              return `
                <tr>
                  <td data-label="User">
                    <div class="admin-user-cell">
                      ${u.avatarUrl ? `
                        <img src="${u.avatarUrl}" class="admin-user-avatar" />
                      ` : `
                        <div class="admin-user-avatar">${avatarLetter}</div>
                      `}
                      <div>
                        <div class="admin-user-info-name">
                          ${SpendlyApp.escapeHtml(u.displayName)}
                          ${u.isAdmin ? '<span class="admin-badge" style="margin-left: 4px;">Admin</span>' : ''}
                        </div>
                        <div class="admin-user-info-username">@${SpendlyApp.escapeHtml(u.username)}</div>
                      </div>
                    </div>
                  </td>
                  <td data-label="Email">${SpendlyApp.escapeHtml(u.email)}</td>
                  <td data-label="Joined">${SpendlyStore.formatDateTime(u.createdAt)}</td>
                  <td data-label="Last Active">${u.lastActiveAt ? SpendlyStore.formatDateTime(u.lastActiveAt) : '<span style="color: var(--text-muted);">Never</span>'}</td>
                  <td data-label="Groups"><strong>${u.groupsCount}</strong></td>
                  <td data-label="Expenses"><strong>${u.expensesCount}</strong></td>
                  <td data-label="Status">
                    <span class="admin-status-badge ${u.status}">
                      ${u.status}
                    </span>
                  </td>
                  <td data-label="Action" style="text-align: right;">
                    <a href="#/admin/users/${u.id}" class="btn btn-sm btn-secondary" style="padding: 6px 12px; font-size: 12px; text-decoration: none;">
                      Inspect &rarr;
                    </a>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>

        <!-- Server-side Pagination Toolbar -->
        <div class="admin-pagination">
          <div>
            Showing ${users.length > 0 ? (pagination.page - 1) * pagination.limit + 1 : 0} to ${Math.min(pagination.page * pagination.limit, pagination.total)} of ${pagination.total} records
          </div>
          <div class="admin-pagination-btns">
            <button 
              class="btn btn-sm btn-secondary" 
              id="admin-prev-page" 
              ${pagination.page <= 1 ? 'disabled' : ''}
            >
              &larr; Previous
            </button>
            <span style="display: flex; align-items: center; padding: 0 10px; font-weight: 600;">
              ${pagination.page} / ${pagination.totalPages || 1}
            </span>
            <button 
              class="btn btn-sm btn-secondary" 
              id="admin-next-page" 
              ${pagination.page >= pagination.totalPages ? 'disabled' : ''}
            >
              Next &rarr;
            </button>
          </div>
        </div>
      </div>
    `;

    SpendlyAdmin.renderShell('users', contentHtml);
    this.attachEvents(pagination);
  },

  attachEvents(pagination) {
    const searchInput = document.getElementById('admin-users-search');
    const statusSelect = document.getElementById('admin-users-status');
    const sortSelect = document.getElementById('admin-users-sort');
    const refreshBtn = document.getElementById('admin-refresh-users-btn');
    const prevBtn = document.getElementById('admin-prev-page');
    const nextBtn = document.getElementById('admin-next-page');

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

    if (statusSelect) {
      statusSelect.onchange = (e) => {
        this.statusFilter = e.target.value;
        this.currentPage = 1;
        this.fetchAndRender();
      };
    }

    if (sortSelect) {
      sortSelect.onchange = (e) => {
        const [field, order] = e.target.value.split(':');
        this.sortBy = field;
        this.sortOrder = order;
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

window.SpendlyAdminUsersView = SpendlyAdminUsersView;
