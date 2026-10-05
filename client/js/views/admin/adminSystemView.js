/**
 * Spendly Admin System Health View
 * Live telemetry, database health, WebSocket stats, email delivery status, and memory metrics.
 */
const SpendlyAdminSystemView = {
  async render() {
    const loadingHtml = `
      <div style="text-align: center; padding: 60px 20px; color: var(--text-muted);">
        <div class="logo-icon" style="margin: 0 auto 16px auto; animation: pulse 1.5s infinite;"></div>
        <p style="font-size: 15px; font-weight: 500;">Polling infrastructure telemetry & health checks...</p>
      </div>
    `;

    SpendlyAdmin.renderShell('system', loadingHtml);

    try {
      const health = await SpendlyAdmin.request('/system/health');
      this.renderContent(health);
    } catch (err) {
      const errorHtml = `
        <div class="empty-state" style="padding: 40px; text-align: center;">
          <h3 style="color: var(--accent-danger); margin-bottom: 8px;">System inspection failed</h3>
          <p style="color: var(--text-secondary); margin-bottom: 20px;">${err.message}</p>
          <button class="btn btn-primary" onclick="SpendlyAdminSystemView.render()">Retry</button>
        </div>
      `;
      SpendlyAdmin.renderShell('system', errorHtml);
    }
  },

  renderContent(health) {
    const { application, database, websocket, emailService, pushService, timestamp } = health;

    const formatUptime = (seconds) => {
      const d = Math.floor(seconds / (3600 * 24));
      const h = Math.floor((seconds % (3600 * 24)) / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = seconds % 60;
      return `${d > 0 ? d + 'd ' : ''}${h}h ${m}m ${s}s`;
    };

    const isDbOk = database.status === 'connected';

    const contentHtml = `
      <div class="admin-header">
        <div>
          <h1 class="admin-title">System Health & Telemetry</h1>
          <p class="admin-subtitle">
            Infrastructure observability, active connections, and service connectivity &bull; Polled ${SpendlyStore.formatDateTime(timestamp)}
          </p>
        </div>
        <button class="btn btn-secondary" id="admin-refresh-health-btn" style="padding: 9px 14px; font-size: 13px;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Re-test Health
        </button>
      </div>

      <div class="admin-health-grid">
        <!-- 1. Node & Express Core -->
        <div class="admin-health-card">
          <div class="admin-health-header">
            <h3 class="admin-health-title">Application Core</h3>
            <span class="admin-health-indicator" style="color: var(--accent-success);">
              <span class="admin-health-dot ok"></span>
              Operational
            </span>
          </div>
          <div class="admin-health-rows">
            <div class="admin-health-row">
              <span class="admin-health-key">App Name</span>
              <span class="admin-health-val">${application.name}</span>
            </div>
            <div class="admin-health-row">
              <span class="admin-health-key">Environment</span>
              <span class="admin-health-val">${application.environment}</span>
            </div>
            <div class="admin-health-row">
              <span class="admin-health-key">Node Runtime</span>
              <span class="admin-health-val">${application.nodeVersion}</span>
            </div>
            <div class="admin-health-row">
              <span class="admin-health-key">System Uptime</span>
              <span class="admin-health-val">${formatUptime(application.uptimeSeconds)}</span>
            </div>
            <div class="admin-health-row">
              <span class="admin-health-key">Memory (RSS / Heap)</span>
              <span class="admin-health-val">${application.memory.rssMb} MB / ${application.memory.heapUsedMb} MB</span>
            </div>
          </div>
        </div>

        <!-- 2. Database -->
        <div class="admin-health-card">
          <div class="admin-health-header">
            <h3 class="admin-health-title">Database Storage</h3>
            <span class="admin-health-indicator" style="color: ${isDbOk ? 'var(--accent-success)' : 'var(--accent-danger)'};">
              <span class="admin-health-dot ${isDbOk ? 'ok' : 'err'}"></span>
              ${isDbOk ? 'Connected' : 'Offline'}
            </span>
          </div>
          <div class="admin-health-rows">
            <div class="admin-health-row">
              <span class="admin-health-key">Database Engine</span>
              <span class="admin-health-val">${database.engine}</span>
            </div>
            <div class="admin-health-row">
              <span class="admin-health-key">Connection Latency</span>
              <span class="admin-health-val">${database.latencyMs !== null ? database.latencyMs + ' ms' : 'N/A'}</span>
            </div>
            <div class="admin-health-row">
              <span class="admin-health-key">Status</span>
              <span class="admin-health-val">${database.status}</span>
            </div>
            <div class="admin-health-row">
              <span class="admin-health-key">Data Integrity</span>
              <span class="admin-health-val">WAL / ACID Compliant</span>
            </div>
          </div>
        </div>

        <!-- 3. WebSocket Real-Time Server -->
        <div class="admin-health-card">
          <div class="admin-health-header">
            <h3 class="admin-health-title">Real-Time WebSockets</h3>
            <span class="admin-health-indicator" style="color: var(--accent-success);">
              <span class="admin-health-dot ok"></span>
              ${websocket.status}
            </span>
          </div>
          <div class="admin-health-rows">
            <div class="admin-health-row">
              <span class="admin-health-key">Path</span>
              <span class="admin-health-val">/ws</span>
            </div>
            <div class="admin-health-row">
              <span class="admin-health-key">Connected Sockets</span>
              <span class="admin-health-val">${websocket.connectedClients} active</span>
            </div>
            <div class="admin-health-row">
              <span class="admin-health-key">Protocol</span>
              <span class="admin-health-val">RFC 6455 &bull; Ping/Pong</span>
            </div>
            <div class="admin-health-row">
              <span class="admin-health-key">Heartbeat Interval</span>
              <span class="admin-health-val">30 seconds</span>
            </div>
          </div>
        </div>

        <!-- 4. Email / OTP Delivery -->
        <div class="admin-health-card">
          <div class="admin-health-header">
            <h3 class="admin-health-title">Transactional Email</h3>
            <span class="admin-health-indicator" style="color: ${emailService.configured ? 'var(--accent-success)' : 'var(--accent-warning)'};">
              <span class="admin-health-dot ${emailService.configured ? 'ok' : 'warn'}"></span>
              ${emailService.configured ? 'Configured' : 'Dev Simulation'}
            </span>
          </div>
          <div class="admin-health-rows">
            <div class="admin-health-row">
              <span class="admin-health-key">Provider</span>
              <span class="admin-health-val">${emailService.provider}</span>
            </div>
            <div class="admin-health-row">
              <span class="admin-health-key">Relay Host</span>
              <span class="admin-health-val">${emailService.host}:${emailService.port}</span>
            </div>
            <div class="admin-health-row">
              <span class="admin-health-key">Purpose</span>
              <span class="admin-health-val">Registration OTP &bull; Password Reset</span>
            </div>
            <div class="admin-health-row">
              <span class="admin-health-key">Credentials Status</span>
              <span class="admin-health-val">${emailService.configured ? 'Verified Server-Side' : 'Missing Env'}</span>
            </div>
          </div>
        </div>

        <!-- 5. Web Push Notification Service -->
        <div class="admin-health-card">
          <div class="admin-health-header">
            <h3 class="admin-health-title">Web Push Notifications</h3>
            <span class="admin-health-indicator" style="color: ${pushService.configured ? 'var(--accent-success)' : 'var(--accent-warning)'};">
              <span class="admin-health-dot ${pushService.configured ? 'ok' : 'warn'}"></span>
              ${pushService.configured ? 'Operational' : 'Unconfigured'}
            </span>
          </div>
          <div class="admin-health-rows">
            <div class="admin-health-row">
              <span class="admin-health-key">Protocol</span>
              <span class="admin-health-val">VAPID &bull; Web Push Protocol</span>
            </div>
            <div class="admin-health-row">
              <span class="admin-health-key">Key Pair Configuration</span>
              <span class="admin-health-val">${pushService.configured ? 'Keys Loaded' : 'Not Configured'}</span>
            </div>
            <div class="admin-health-row">
              <span class="admin-health-key">Target Platforms</span>
              <span class="admin-health-val">PWA &bull; Mobile &bull; Desktop</span>
            </div>
          </div>
        </div>
      </div>
    `;

    SpendlyAdmin.renderShell('system', contentHtml);

    const refreshBtn = document.getElementById('admin-refresh-health-btn');
    if (refreshBtn) {
      refreshBtn.onclick = () => {
        this.render();
      };
    }
  }
};

window.SpendlyAdminSystemView = SpendlyAdminSystemView;
