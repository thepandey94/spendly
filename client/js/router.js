/**
 * Spendly Client SPA Hash Router
 */
const SpendlyRouter = {
  currentRoute: '',
  currentParams: {},

  init() {
    window.addEventListener('hashchange', () => this.handleRoute());
    this.handleRoute();
  },

  handleRoute() {
    const hash = window.location.hash || '#/own-expenses';
    const isAuthenticated = !!SpendlyStore.state.token;

    // Authentication Guard
    if (!isAuthenticated && hash !== '#/auth') {
      window.location.hash = '#/auth';
      return;
    }

    if (isAuthenticated && hash === '#/auth') {
      window.location.hash = '#/own-expenses';
      return;
    }

    this.currentRoute = hash;
    SpendlyStore.state.activeRoute = hash;

    // Toggle app shell visibility: hide header and sidebar if in #/auth
    const header = document.querySelector('.app-header');
    const sidebar = document.querySelector('.app-sidebar');
    const content = document.querySelector('.app-content');

    if (hash === '#/auth') {
      if (header) header.style.display = 'none';
      if (sidebar) sidebar.style.display = 'none';
      if (content) {
        content.style.marginLeft = '0';
        content.style.marginTop = '0';
        content.style.padding = '0';
      }
      SpendlyAuthView.render();
      return;
    } else {
      if (header) header.style.display = 'flex';
      if (sidebar) sidebar.style.display = 'flex';
      if (content) {
        content.style.marginLeft = '';
        content.style.marginTop = '';
        content.style.padding = '';
      }
    }

    // Update active nav items in sidebar
    document.querySelectorAll('.nav-item-link').forEach(link => {
      const href = link.getAttribute('href');
      if (hash.startsWith(href)) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    // Close mobile drawer if open
    SpendlyApp.closeSidebar();

    // Admin Routes Guard & Shell Handling
    if (hash.startsWith('#/admin')) {
      if (header) header.style.display = 'none';
      if (sidebar) sidebar.style.display = 'none';
      if (content) {
        content.style.marginLeft = '0';
        content.style.marginTop = '0';
        content.style.padding = '0';
      }

      if (hash === '#/admin/login') {
        SpendlyAdminLoginView.render();
        return;
      }

      // Check admin authentication
      if (!SpendlyAdmin.getToken()) {
        window.location.hash = '#/admin/login';
        return;
      }

      if (hash === '#/admin' || hash === '#/admin/dashboard') {
        SpendlyAdminDashboardView.render();
      } else if (hash === '#/admin/users') {
        SpendlyAdminUsersView.render();
      } else if (hash.startsWith('#/admin/users/')) {
        const parts = hash.split('/');
        const userId = parts[3] || null;
        SpendlyAdminUserDetailsView.render(userId);
      } else if (hash === '#/admin/audit') {
        SpendlyAdminAuditView.render();
      } else if (hash === '#/admin/system') {
        SpendlyAdminSystemView.render();
      } else {
        window.location.hash = '#/admin/dashboard';
      }
      return;
    }

    // Match route
    if (hash === '#/own-expenses') {
      SpendlyOwnExpensesView.render();
    } else if (hash.startsWith('#/split-it')) {
      const parts = hash.split('/');
      const groupId = parts[2] || null;
      SpendlySplitItView.render(groupId);
    } else if (hash === '#/bill') {
      SpendlyBillView.render();
    } else if (hash === '#/analytics') {
      SpendlyAnalyticsView.render();
    } else if (hash === '#/profile') {
      SpendlyProfileView.render();
    } else {
      window.location.hash = '#/own-expenses';
    }
  },

  refreshCurrentView() {
    this.handleRoute();
  }
};

window.SpendlyRouter = SpendlyRouter;
