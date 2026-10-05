/**
 * Spendly Admin Login View
 * Secure Administrative Authentication Interface
 */
const SpendlyAdminLoginView = {
  render() {
    const container = document.getElementById('main-view-container');
    container.innerHTML = `
      <div class="auth-container" style="background: radial-gradient(circle at 50% 20%, rgba(15, 157, 154, 0.08), transparent 70%);">
        <div class="auth-card" style="border-top: 4px solid var(--accent-primary);">
          <div class="auth-brand" style="margin-bottom: 24px;">
            <a href="#/own-expenses" class="brand-logo" style="justify-content: center;">
              <div class="logo-icon" aria-hidden="true"></div>
              <span>Spendly</span>
            </a>
            <div style="margin-top: 10px; display: flex; justify-content: center;">
              <span class="admin-badge" style="font-size: 11px; padding: 4px 10px;">
                Administrative Console
              </span>
            </div>
            <p class="auth-subtitle" style="margin-top: 10px;">
              Sign in with your verified administrative credentials
            </p>
          </div>

          <form id="admin-login-form" autocomplete="on">
            <div class="form-group">
              <label class="form-label" for="admin-login-identifier">Admin Username or Email</label>
              <input 
                type="text" 
                id="admin-login-identifier" 
                class="form-input" 
                placeholder="Enter username or email" 
                required 
                autocomplete="username"
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="admin-login-password">Password</label>
              <input 
                type="password" 
                id="admin-login-password" 
                class="form-input" 
                placeholder="Enter your password" 
                required 
                autocomplete="current-password"
              />
            </div>

            <div id="admin-login-error" style="display: none; padding: 10px 14px; background: var(--accent-danger-subtle); color: var(--accent-danger); border-radius: var(--radius-md); font-size: 13px; font-weight: 500; margin-bottom: 16px;"></div>

            <button type="submit" class="btn btn-primary" id="admin-login-btn" style="width: 100%; justify-content: center; height: 46px; font-size: 15px;">
              Sign In to Admin
            </button>
          </form>

          <div style="margin-top: 24px; text-align: center; border-top: 1px solid var(--border-subtle); padding-top: 18px;">
            <a href="#/own-expenses" style="font-size: 13px; color: var(--text-muted); text-decoration: none; display: inline-flex; align-items: center; gap: 6px;">
              <span>&larr;</span> Back to Spendly App
            </a>
          </div>
        </div>
      </div>
    `;

    this.attachEvents();
  },

  attachEvents() {
    const form = document.getElementById('admin-login-form');
    const btn = document.getElementById('admin-login-btn');
    const errEl = document.getElementById('admin-login-error');

    if (!form) return;

    form.onsubmit = async (e) => {
      e.preventDefault();
      errEl.style.display = 'none';

      const identifier = document.getElementById('admin-login-identifier').value.trim();
      const password = document.getElementById('admin-login-password').value;

      if (!identifier || !password) {
        errEl.textContent = 'Please enter both username/email and password.';
        errEl.style.display = 'block';
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Authenticating...';

      try {
        const res = await fetch('/api/admin/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier, password })
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Authentication failed');
        }

        // Store admin credentials
        SpendlyAdmin.setToken(data.token, data.user);

        SpendlyApp.showToast({
          type: 'success',
          title: 'Admin Access Granted',
          message: `Welcome back, Administrator @${data.user.username}!`
        });

        window.location.hash = '#/admin/dashboard';
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Sign In to Admin';
      }
    };
  }
};

window.SpendlyAdminLoginView = SpendlyAdminLoginView;
