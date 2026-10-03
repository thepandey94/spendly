/**
 * Spendly WebSocket Client for Real-Time Synchronization
 */
const SpendlyWS = {
  socket: null,
  listeners: new Map(),
  reconnectAttempts: 0,
  maxReconnectAttempts: 10,
  reconnectTimeout: null,
  subscribedGroups: new Set(),

  connect(token) {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws`;

    try {
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        console.log('[Spendly WS] Connected to real-time server');
        this.reconnectAttempts = 0;

        // Authenticate with current token
        if (token || localStorage.getItem('spendly_token')) {
          this.send({
            action: 'auth',
            token: token || localStorage.getItem('spendly_token')
          });
        }

        // Resubscribe to any active groups
        this.subscribedGroups.forEach((groupId) => {
          this.send({ action: 'subscribe_group', groupId });
        });
      };

      this.socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          this.dispatch(payload.event, payload.data || payload);
        } catch (err) {
          console.error('[Spendly WS] Error parsing message:', err);
        }
      };

      this.socket.onclose = () => {
        console.warn('[Spendly WS] Disconnected from real-time server');
        this.scheduleReconnect();
      };

      this.socket.onerror = (err) => {
        console.error('[Spendly WS] Socket error:', err);
      };
    } catch (err) {
      console.error('[Spendly WS] Failed to initialize socket:', err);
      this.scheduleReconnect();
    }
  },

  scheduleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 15000);
      this.reconnectAttempts++;
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = setTimeout(() => {
        this.connect();
      }, delay);
    }
  },

  send(data) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    }
  },

  subscribeGroup(groupId) {
    this.subscribedGroups.add(groupId);
    this.send({ action: 'subscribe_group', groupId });
  },

  unsubscribeGroup(groupId) {
    this.subscribedGroups.delete(groupId);
    this.send({ action: 'unsubscribe_group', groupId });
  },

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  },

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  },

  dispatch(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach((cb) => {
        try {
          cb(data);
        } catch (err) {
          console.error(`[Spendly WS] Listener error for ${event}:`, err);
        }
      });
    }
  }
};

window.SpendlyWS = SpendlyWS;
