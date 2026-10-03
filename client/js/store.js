/**
 * Spendly Central Reactive State Store & Financial Formatting Utilities
 */
const SpendlyStore = {
  state: {
    user: null,
    token: localStorage.getItem('spendly_token') || null,
    isOnline: navigator.onLine,
    unreadCount: 0,
    offlineQueueCount: 0,
    activeRoute: '#/own-expenses'
  },

  subscribers: new Set(),

  init() {
    const savedUser = localStorage.getItem('spendly_user');
    if (savedUser) {
      try {
        this.state.user = JSON.parse(savedUser);
      } catch (err) {
        this.state.user = null;
      }
    }
  },

  setAuth(user, token) {
    this.state.user = user;
    this.state.token = token;
    if (token) {
      localStorage.setItem('spendly_token', token);
      localStorage.setItem('spendly_user', JSON.stringify(user));
      SpendlyWS.connect(token);
    } else {
      localStorage.removeItem('spendly_token');
      localStorage.removeItem('spendly_user');
    }
    this.notify();
  },

  setUser(user) {
    this.state.user = user;
    localStorage.setItem('spendly_user', JSON.stringify(user));
    this.notify();
  },

  setOnlineStatus(isOnline) {
    this.state.isOnline = isOnline;
    this.notify();
  },

  setUnreadCount(count) {
    this.state.unreadCount = count;
    this.notify();
  },

  setOfflineQueueCount(count) {
    this.state.offlineQueueCount = count;
    this.notify();
  },

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  },

  notify() {
    this.subscribers.forEach((cb) => cb(this.state));
  },

  /**
   * Currency Formatter for Indian Rupee (INR / ₹)
   * Exact decimal display with 2 decimal places and Indian grouping (e.g. ₹1,250.50)
   * @param {number} paise - Amount in integer paise
   */
  formatINR(paise) {
    if (paise === null || paise === undefined || isNaN(paise)) {
      return '₹0.00';
    }
    const rupees = paise / 100;
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(rupees);
  },

  /**
   * Format epoch timestamp to readable Indian date & time
   */
  formatDateTime(epochMs) {
    if (!epochMs) return '';
    const date = new Date(epochMs);
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).format(date);
  }
};

SpendlyStore.init();
window.SpendlyStore = SpendlyStore;
