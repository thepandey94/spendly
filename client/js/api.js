/**
 * Spendly API Client with Offline Interceptor and Background Synchronization
 */
const SpendlyAPI = {
  async request(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `/api${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
    const headers = options.headers || {};

    if (SpendlyStore.state.token) {
      headers['Authorization'] = `Bearer ${SpendlyStore.state.token}`;
    }

    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    const config = {
      ...options,
      headers
    };

    // If client is offline
    if (!navigator.onLine) {
      return this.handleOfflineRequest(endpoint, options);
    }

    try {
      const response = await fetch(url, config);
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        // If 401 Unauthorized, clear auth and route to login
        if (response.status === 401 && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/register')) {
          SpendlyStore.setAuth(null, null);
          window.location.hash = '#/auth';
        }
        const errorMsg = data.error || 'Server request failed';
        throw new Error(errorMsg);
      }

      return data;
    } catch (err) {
      // If network failure occurs during expense creation, route to offline queue
      if (!navigator.onLine || err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        return this.handleOfflineRequest(endpoint, options);
      }
      throw err;
    }
  },

  async handleOfflineRequest(endpoint, options) {
    // If billing while offline, disallow per requirement Section 53
    if (endpoint.includes('/billing')) {
      throw new Error('Billing requires an active server connection to prevent conflicting bills.');
    }

    // If adding personal or group expense offline, queue safely with idempotency key
    if (options.method === 'POST' && (endpoint === '/personal/expenses' || endpoint.includes('/expenses'))) {
      const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body || {};
      const idempotencyKey = body.idempotencyKey || crypto.randomUUID();
      body.idempotencyKey = idempotencyKey;

      await SpendlyIDB.queueOfflineAction({
        endpoint,
        method: options.method,
        body,
        idempotencyKey
      });

      SpendlyApp.showToast({
        type: 'warning',
        title: 'Offline Mode',
        message: 'Expense saved locally. It will synchronize automatically once reconnected.'
      });

      // Update queue count
      const queue = await SpendlyIDB.getOfflineQueue();
      SpendlyStore.setOfflineQueueCount(queue.length);

      // Return optimistic response
      return {
        expense: {
          id: 'temp_' + idempotencyKey,
          description: body.description,
          amount: Math.round(Math.abs(body.amount) * 100),
          created_at: Date.now(),
          isOfflinePending: true
        }
      };
    }

    throw new Error('You are currently offline. Please check your internet connection.');
  },

  get(endpoint) {
    return this.request(endpoint, { method: 'GET' });
  },

  post(endpoint, body) {
    return this.request(endpoint, {
      method: 'POST',
      body: body instanceof FormData ? body : JSON.stringify(body)
    });
  },

  put(endpoint, body) {
    return this.request(endpoint, {
      method: 'PUT',
      body: body instanceof FormData ? body : JSON.stringify(body)
    });
  },

  delete(endpoint, body = null) {
    return this.request(endpoint, {
      method: 'DELETE',
      body: body ? JSON.stringify(body) : undefined
    });
  },

  /**
   * Drain offline queue and synchronize pending expenses with server
   */
  async syncOfflineQueue() {
    if (!navigator.onLine) return;

    const queue = await SpendlyIDB.getOfflineQueue();
    if (queue.length === 0) {
      SpendlyStore.setOfflineQueueCount(0);
      return;
    }

    console.log(`[Spendly Sync] Draining ${queue.length} offline operation(s)...`);
    let successCount = 0;
    let failedCount = 0;

    for (const item of queue) {
      try {
        await this.request(item.endpoint, {
          method: item.method,
          body: JSON.stringify(item.body)
        });
        await SpendlyIDB.removeOfflineAction(item.idempotencyKey);
        successCount++;
      } catch (err) {
        console.error('[Spendly Sync] Failed to sync item:', err);
        failedCount++;
      }
    }

    const remaining = await SpendlyIDB.getOfflineQueue();
    SpendlyStore.setOfflineQueueCount(remaining.length);

    if (successCount > 0) {
      SpendlyApp.showToast({
        type: 'success',
        title: 'Sync Complete',
        message: `Successfully synchronized ${successCount} offline expense(s).`
      });
      // Refresh current view
      SpendlyRouter.refreshCurrentView();
    }

    if (failedCount > 0) {
      SpendlyApp.showToast({
        type: 'error',
        title: 'Sync Partial Failure',
        message: `${failedCount} operation(s) failed to sync. Tap retry to attempt again.`
      });
    }
  }
};

window.SpendlyAPI = SpendlyAPI;
