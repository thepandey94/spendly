/**
 * Spendly Admin Core Utilities & Layout Shell Manager
 */
const SpendlyAdmin = {
  getToken() {
    return sessionStorage.getItem('spendly_admin_token') || localStorage.getItem('spendly_admin_token') || null;
  },

  getUser() {
    try {
      const u = sessionStorage.getItem('spendly_admin_user') || localStorage.getItem('spendly_admin_user');
      return u ? JSON.parse(u) : null;
    } catch (e) {
      return null;
    }
  },

  setToken(token, user) {
    if (token) {
      sessionStorage.setItem('spendly_admin_token', token);
      localStorage.setItem('spendly_admin_token', token);
      if (user) {
        sessionStorage.setItem('spendly_admin_user', JSON.stringify(user));
        localStorage.setItem('spendly_admin_user', JSON.stringify(user));
      }
    } else {
      sessionStorage.removeItem('spendly_admin_token');
      sessionStorage.removeItem('spendly_admin_user');
      localStorage.removeItem('spendly_admin_token');
      localStorage.removeItem('spendly_admin_user');
    }
  },

  async request(endpoint, options = {}) {
    const url = `/api/admin${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
    const headers = options.headers || {};
    const token = this.getToken();

    if (!token) {
      window.location.hash = '#/admin/login';
      throw new Error('Administrative authentication required.');
    }

    headers['Authorization'] = `Bearer ${token}`;
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    try {
      const res = await fetch(url, { ...options, headers });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          SpendlyApp.showToast({
            type: 'error',
            title: 'Admin Session Expired',
            message: data.error || 'Please log in with administrative privileges.'
          });
          this.setToken(null);
          window.location.hash = '#/admin/login';
        }
        throw new Error(data.error || 'Admin request failed');
      }

      return data;
    } catch (err) {
      if (err.message.includes('Failed to fetch') || !navigator.onLine) {
        throw new Error('Connection error. Admin Console requires an active internet connection.');
      }
      throw err;
    }
  },

  async logout() {
    try {
      await this.request('/auth/logout', { method: 'POST' });
    } catch (e) {
      // ignore
    }
    this.setToken(null);
    SpendlyApp.showToast({
      type: 'info',
      title: 'Logged Out',
      message: 'Administrative session ended.'
    });
    window.location.hash = '#/admin/login';
  },

  /**
   * Render Admin Page Layout with Topbar and Sidebar
   */
  renderShell(activeNav, contentHtml) {
    const user = this.getUser() || { username: 'Admin', display_name: 'Administrator' };
    const avatarLetter = (user.display_name || user.username || 'A')[0].toUpperCase();

    const container = document.getElementById('main-view-container');
    container.innerHTML = `
      <div class="admin-shell">
        <!-- Admin Sidebar -->
        <aside class="admin-sidebar" id="admin-sidebar">
          <div class="admin-sidebar-header">
            <a href="#/admin/dashboard" class="admin-brand">
              <div class="logo-icon" style="width: 28px; height: 28px;" aria-hidden="true"></div>
              <span style="font-family: var(--font-heading); font-weight: 700; font-size: 18px;">Spendly</span>
              <span class="admin-badge">Admin</span>
            </a>
            <button class="btn btn-sm btn-secondary" id="admin-sidebar-close" style="display: none; padding: 4px 8px;">
              &times;
            </button>
          </div>

          <ul class="admin-nav-list">
            <li>
              <a href="#/admin/dashboard" class="admin-nav-link ${activeNav === 'dashboard' ? 'active' : ''}">
                <svg viewBox="0 0 24 24" fill="none"><path d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 12a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1v-7z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>
                <span>Dashboard</span>
              </a>
            </li>
            <li>
              <a href="#/admin/users" class="admin-nav-link ${activeNav === 'users' ? 'active' : ''}">
                <svg viewBox="0 0 24 24" fill="none"><path d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>
                <span>Users</span>
              </a>
            </li>
            <li>
              <a href="#/admin/audit" class="admin-nav-link ${activeNav === 'audit' ? 'active' : ''}">
                <svg viewBox="0 0 24 24" fill="none"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>
                <span>Audit Logs</span>
              </a>
            </li>
            <li>
              <a href="#/admin/system" class="admin-nav-link ${activeNav === 'system' ? 'active' : ''}">
                <svg viewBox="0 0 24 24" fill="none"><path d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>
                <span>System Health</span>
              </a>
            </li>
          </ul>

          <div class="admin-sidebar-footer">
            <a href="#/own-expenses" class="admin-nav-link" style="color: var(--accent-secondary);">
              <svg viewBox="0 0 24 24" fill="none"><path d="M10 19l-7-7m0 0l7-7m-7 7h18" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span>Back to Spendly</span>
            </a>
            <button class="admin-nav-link" id="admin-logout-btn" style="border: none; background: none; width: 100%; cursor: pointer; color: var(--accent-danger);">
              <svg viewBox="0 0 24 24" fill="none"><path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span>Logout</span>
            </button>
          </div>
        </aside>

        <!-- Main Workspace -->
        <div class="admin-main">
          <header class="admin-topbar">
            <div class="admin-topbar-left">
              <button class="admin-toggle-btn" id="admin-sidebar-toggle" aria-label="Toggle Navigation">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              </button>
              <div class="admin-breadcrumbs">
                <span>Admin</span> &rsaquo; <span style="text-transform: capitalize;">${activeNav}</span>
              </div>
            </div>

            <div class="admin-topbar-right">
              <div class="admin-profile-pill">
                ${user.avatar_url ? `
                  <img src="${user.avatar_url}" class="admin-avatar-small" />
                ` : `
                  <div class="admin-avatar-small">${avatarLetter}</div>
                `}
                <span>@${user.username}</span>
              </div>
            </div>
          </header>

          <main class="admin-body">
            ${contentHtml}
          </main>
        </div>
      </div>
    `;

    this.attachShellEvents();
  },

  attachShellEvents() {
    const sidebar = document.getElementById('admin-sidebar');
    const toggleBtn = document.getElementById('admin-sidebar-toggle');
    const closeBtn = document.getElementById('admin-sidebar-close');
    const logoutBtn = document.getElementById('admin-logout-btn');

    if (toggleBtn && sidebar) {
      toggleBtn.onclick = () => {
        sidebar.classList.toggle('open');
      };
    }

    if (closeBtn && sidebar) {
      closeBtn.onclick = () => {
        sidebar.classList.remove('open');
      };
    }

    if (logoutBtn) {
      logoutBtn.onclick = () => {
        this.logout();
      };
    }
  }
};

window.SpendlyAdmin = SpendlyAdmin;
