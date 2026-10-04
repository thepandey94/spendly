/**
 * Spendly Main Application Bootstrap & UI Manager
 */
const SpendlyApp = {
  activeModalCloseCallback: null,

  init() {
    this.registerServiceWorker();
    this.setupNetworkMonitoring();
    this.setupSidebar();
    this.setupNotifications();
    this.setupStoreSubscriptions();

    // If authenticated, connect WebSocket
    if (SpendlyStore.state.token) {
      SpendlyWS.connect(SpendlyStore.state.token);
      this.fetchNotifications();
    }

    // Initialize SPA Router
    SpendlyRouter.init();

    // Setup PWA Installation Prompt Listener
    this.setupPwaInstall();
  },

  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        console.log('[Spendly SW] Service Worker registered:', reg.scope);
      }).catch((err) => {
        console.warn('[Spendly SW] Registration failed:', err);
      });
    }
  },

  setupPwaInstall() {
    let deferredPrompt = null;
    const installItem = document.getElementById('sidebar-install-item');
    const installBtn = document.getElementById('pwa-install-btn');

    // Capture standard PWA installation prompt (Chrome Android, Desktop Chrome, Edge)
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      if (installItem) {
        installItem.style.display = 'block';
      }
    });

    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) {
          // iOS Safari Add to Home Screen guidance
          const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
          if (isIos) {
            SpendlyApp.showToast({
              type: 'info',
              title: 'Install on iOS',
              message: 'Tap the Share icon at the bottom of Safari and select "Add to Home Screen".'
            });
          }
          return;
        }
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          if (installItem) installItem.style.display = 'none';
        }
        deferredPrompt = null;
      });
    }

    window.addEventListener('appinstalled', () => {
      if (installItem) installItem.style.display = 'none';
      deferredPrompt = null;
      console.log('[Spendly PWA] App was successfully installed to home screen');
    });

    // On iOS Safari outside standalone mode, show install helper
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (isIos && !isStandalone && installItem) {
      installItem.style.display = 'block';
    }
  },

  setupNetworkMonitoring() {
    const offlineBanner = document.getElementById('global-offline-banner');
    const syncIndicator = document.getElementById('header-sync-status');
    const syncDot = document.getElementById('header-sync-dot');
    const syncText = document.getElementById('header-sync-text');

    const updateStatus = () => {
      const isOnline = navigator.onLine;
      SpendlyStore.setOnlineStatus(isOnline);

      if (isOnline) {
        if (offlineBanner) offlineBanner.classList.add('hidden');
        if (syncIndicator) {
          syncIndicator.className = 'sync-indicator online';
          syncText.textContent = 'Live';
        }
        // Sync any pending offline actions
        SpendlyAPI.syncOfflineQueue();
      } else {
        if (offlineBanner) offlineBanner.classList.remove('hidden');
        if (syncIndicator) {
          syncIndicator.className = 'sync-indicator offline';
          syncText.textContent = 'Offline';
        }
      }
    };

    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    updateStatus();

    // Manual sync button in offline banner
    const retrySyncBtn = document.getElementById('retry-sync-btn');
    if (retrySyncBtn) {
      retrySyncBtn.onclick = () => SpendlyAPI.syncOfflineQueue();
    }
  },

  setupSidebar() {
    const menuBtn = document.getElementById('menu-toggle-btn');
    const sidebar = document.querySelector('.app-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');

    if (menuBtn) {
      menuBtn.onclick = (e) => {
        e.stopPropagation();
        this.toggleSidebar();
      };
    }

    if (backdrop) {
      backdrop.onclick = () => this.closeSidebar();
    }

    // Auto-close drawer on mobile when clicking navigation links
    if (sidebar) {
      const navLinks = sidebar.querySelectorAll('.nav-item-link');
      navLinks.forEach((link) => {
        link.addEventListener('click', () => {
          if (window.innerWidth <= 900) {
            this.closeSidebar();
          }
        });
      });
    }
  },

  toggleSidebar() {
    const sidebar = document.querySelector('.app-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (!sidebar) return;

    const isMobile = window.innerWidth <= 900;
    if (isMobile) {
      const isOpen = sidebar.classList.contains('open');
      if (isOpen) {
        sidebar.classList.remove('open');
        if (backdrop) backdrop.classList.remove('active');
      } else {
        sidebar.classList.add('open');
        if (backdrop) backdrop.classList.add('active');
      }
    } else {
      // Desktop toggle: Toggle collapsed state
      const isCollapsed = sidebar.classList.contains('collapsed');
      if (isCollapsed) {
        sidebar.classList.remove('collapsed');
        document.body.classList.remove('sidebar-collapsed');
      } else {
        sidebar.classList.add('collapsed');
        document.body.classList.add('sidebar-collapsed');
      }
    }
  },

  closeSidebar() {
    const sidebar = document.querySelector('.app-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (sidebar) sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('active');
  },

  setupNotifications() {
    const bellBtn = document.getElementById('notification-bell-btn');
    const dropdown = document.getElementById('notifications-dropdown');

    if (bellBtn && dropdown) {
      bellBtn.onclick = (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains('active');
        if (!isOpen) {
          this.fetchNotifications();
          dropdown.classList.add('active');
        } else {
          dropdown.classList.remove('active');
        }
      };

      document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && e.target !== bellBtn) {
          dropdown.classList.remove('active');
        }
      });
    }

    // Real-time notification sound / toast via WebSocket
    SpendlyWS.on('notification', (notification) => {
      this.showToast({
        type: 'info',
        title: notification.title,
        message: notification.message
      });
      this.fetchNotifications();
    });
  },

  async fetchNotifications() {
    if (!SpendlyStore.state.token) return;
    try {
      const res = await SpendlyAPI.get('/notifications');
      SpendlyStore.setUnreadCount(res.unreadCount);
      this.renderNotificationsDropdown(res.notifications);
    } catch (err) {
      // ignore
    }
  },

  renderNotificationsDropdown(notifications) {
    const listContainer = document.getElementById('notifications-list');
    const markAllBtn = document.getElementById('mark-all-read-btn');

    if (markAllBtn) {
      markAllBtn.onclick = async () => {
        try {
          await SpendlyAPI.post('/notifications/mark-read', {});
          SpendlyStore.setUnreadCount(0);
          this.fetchNotifications();
        } catch (e) {}
      };
    }

    if (!listContainer) return;

    if (!notifications || notifications.length === 0) {
      listContainer.innerHTML = `
        <div style="padding: 30px 20px; text-align: center; color: var(--text-muted); font-size: 13px;">
          No notifications yet.
        </div>
      `;
      return;
    }

    listContainer.innerHTML = notifications.map(n => `
      <div class="notification-item ${n.read ? '' : 'unread'}">
        <div class="notification-item-title">${this.escapeHtml(n.title)}</div>
        <div class="notification-item-msg">${this.escapeHtml(n.message)}</div>
        <div class="notification-item-time">${SpendlyStore.formatDateTime(n.created_at)}</div>

        ${n.type === 'group_invitation' && n.data && n.data.invitationId ? `
          <div class="notification-actions">
            <button class="btn btn-sm btn-primary accept-invite-btn" data-invite-id="${n.data.invitationId}" data-notif-id="${n.id}">
              Accept
            </button>
            <button class="btn btn-sm btn-secondary decline-invite-btn" data-invite-id="${n.data.invitationId}" data-notif-id="${n.id}">
              Decline
            </button>
          </div>
        ` : ''}

        ${n.type === 'leave_request' && n.data && n.data.groupId && n.data.userId ? `
          <div class="notification-actions">
            <button class="btn btn-sm btn-primary approve-leave-btn" data-group-id="${n.data.groupId}" data-user-id="${n.data.userId}" data-notif-id="${n.id}">
              Approve Leave
            </button>
            <button class="btn btn-sm btn-secondary reject-leave-btn" data-group-id="${n.data.groupId}" data-user-id="${n.data.userId}" data-notif-id="${n.id}">
              Reject
            </button>
          </div>
        ` : ''}
      </div>
    `).join('');

    // Attach actions for invitations inside notifications
    listContainer.querySelectorAll('.accept-invite-btn').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const inviteId = btn.getAttribute('data-invite-id');
        const notifId = btn.getAttribute('data-notif-id');
        try {
          const res = await SpendlyAPI.post(`/groups/invitations/${inviteId}/respond`, { accept: true });
          SpendlyApp.showToast({ type: 'success', title: 'Joined Group', message: 'You have joined the group!' });
          await SpendlyAPI.post('/notifications/mark-read', { notificationId: notifId });
          this.fetchNotifications();
          window.location.hash = `#/split-it/${res.groupId}`;
        } catch (err) {
          SpendlyApp.showToast({ type: 'error', title: 'Error', message: err.message });
        }
      };
    });

    listContainer.querySelectorAll('.decline-invite-btn').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const inviteId = btn.getAttribute('data-invite-id');
        const notifId = btn.getAttribute('data-notif-id');
        try {
          await SpendlyAPI.post(`/groups/invitations/${inviteId}/respond`, { accept: false });
          SpendlyApp.showToast({ type: 'info', title: 'Declined', message: 'Invitation declined.' });
          await SpendlyAPI.post('/notifications/mark-read', { notificationId: notifId });
          this.fetchNotifications();
        } catch (err) {
          SpendlyApp.showToast({ type: 'error', title: 'Error', message: err.message });
        }
      };
    });

    // Attach actions for leave requests inside notifications (Part 10)
    listContainer.querySelectorAll('.approve-leave-btn').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const groupId = btn.getAttribute('data-group-id');
        const targetUserId = btn.getAttribute('data-user-id');
        const notifId = btn.getAttribute('data-notif-id');
        try {
          await SpendlyAPI.post(`/groups/${groupId}/members/${targetUserId}/approve-leave`);
          SpendlyApp.showToast({ type: 'success', title: 'Leave Approved', message: 'Member leave request was approved.' });
          await SpendlyAPI.post('/notifications/mark-read', { notificationId: notifId });
          this.fetchNotifications();
          if (window.location.hash.includes(groupId) && window.SpendlySplitItView) {
            SpendlySplitItView.loadGroupDetail(groupId);
          }
        } catch (err) {
          SpendlyApp.showToast({ type: 'error', title: 'Action Prohibited', message: err.message });
        }
      };
    });

    listContainer.querySelectorAll('.reject-leave-btn').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const groupId = btn.getAttribute('data-group-id');
        const targetUserId = btn.getAttribute('data-user-id');
        const notifId = btn.getAttribute('data-notif-id');
        try {
          await SpendlyAPI.post(`/groups/${groupId}/members/${targetUserId}/reject-leave`);
          SpendlyApp.showToast({ type: 'info', title: 'Leave Declined', message: 'Member leave request was rejected.' });
          await SpendlyAPI.post('/notifications/mark-read', { notificationId: notifId });
          this.fetchNotifications();
          if (window.location.hash.includes(groupId) && window.SpendlySplitItView) {
            SpendlySplitItView.loadGroupDetail(groupId);
          }
        } catch (err) {
          SpendlyApp.showToast({ type: 'error', title: 'Error', message: err.message });
        }
      };
    });
  },

  setupStoreSubscriptions() {
    SpendlyStore.subscribe((state) => {
      // Unread notification badge
      const badge = document.getElementById('notification-badge-count');
      if (badge) {
        if (state.unreadCount > 0) {
          badge.textContent = state.unreadCount > 99 ? '99+' : state.unreadCount;
          badge.style.display = 'block';
        } else {
          badge.style.display = 'none';
        }
      }

      // Header user profile
      const user = state.user;
      const avatarContainer = document.getElementById('header-user-avatar');
      if (avatarContainer) {
        if (user) {
          if (user.avatar_url) {
            avatarContainer.innerHTML = `<img src="${user.avatar_url}" class="user-avatar-img" />`;
          } else {
            avatarContainer.innerHTML = `
              <div class="user-avatar-placeholder">
                ${(user.display_name || user.username || 'U')[0].toUpperCase()}
              </div>
            `;
          }
        } else {
          avatarContainer.innerHTML = '';
        }
      }
    });
  },

  /**
   * Dispatch floating toast notification
   */
  showToast({ type = 'info', title, message, duration = 4000 }) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <div class="toast-body">
        <div class="toast-title">${this.escapeHtml(title)}</div>
        <div class="toast-message">${this.escapeHtml(message)}</div>
      </div>
      <button class="toast-close">&times;</button>
    `;

    toast.querySelector('.toast-close').onclick = () => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 250);
    };

    container.appendChild(toast);

    if (duration > 0) {
      setTimeout(() => {
        if (toast.parentElement) {
          toast.style.opacity = '0';
          toast.style.transform = 'translateX(100%)';
          setTimeout(() => toast.remove(), 250);
        }
      }, duration);
    }
  },

  /**
   * Show modal dialog using native HTML5 <dialog>
   */
  showModal({ title, renderBody, confirmText = 'Confirm', isDanger = false, onConfirm = null }) {
    const dialog = document.getElementById('global-modal-dialog');
    const titleEl = document.getElementById('modal-title-text');
    const bodyEl = document.getElementById('modal-body-content');
    const confirmBtn = document.getElementById('modal-confirm-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');
    const closeBtn = document.getElementById('modal-close-x');

    if (!dialog) return;

    titleEl.textContent = title;
    bodyEl.innerHTML = renderBody();
    confirmBtn.textContent = confirmText;
    confirmBtn.className = isDanger ? 'btn btn-danger' : 'btn btn-primary';

    const closeModal = () => {
      dialog.close();
    };

    cancelBtn.onclick = closeModal;
    closeBtn.onclick = closeModal;

    confirmBtn.onclick = async () => {
      if (onConfirm) {
        confirmBtn.disabled = true;
        await onConfirm(closeModal);
        confirmBtn.disabled = false;
      } else {
        closeModal();
      }
    };

    dialog.showModal();
  },

  /**
   * Convenience confirm modal
   */
  showConfirmModal({ title, message, confirmText = 'Yes, Proceed', isDanger = false, onConfirm }) {
    this.showModal({
      title,
      renderBody: () => `<p style="font-size: 14px; color: var(--text-secondary); line-height: 1.6;">${message}</p>`,
      confirmText,
      isDanger,
      onConfirm
    });
  },

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
};

window.SpendlyApp = SpendlyApp;

document.addEventListener('DOMContentLoaded', () => {
  SpendlyApp.init();
});
