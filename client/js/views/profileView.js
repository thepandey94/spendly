/**
 * Spendly Profile View
 * Implements profile photo upload, display name & bio management,
 * username change (with 30-day cooldown enforcement), email change (with OTP verification),
 * password change, logout, and permanent account deletion (with billing obligation checks).
 */
const SpendlyProfileView = {
  user: null,

  async render() {
    const container = document.getElementById('main-view-container');
    this.user = SpendlyStore.state.user;

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Profile Settings</h1>
          <p class="page-subtitle">Manage your account credentials, display preferences, and security</p>
        </div>
        <button class="btn btn-secondary" id="profile-logout-btn">
          <svg viewBox="0 0 24 24" fill="none"><path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" stroke="currentColor"/></svg>
          Log Out
        </button>
      </div>

      <div class="profile-grid">
        <!-- Left: Avatar Card -->
        <div class="card profile-avatar-card">
          <div class="profile-avatar-upload-wrapper" id="avatar-upload-trigger" title="Click to upload profile photo">
            ${this.user.avatar_url ? `
              <img src="${this.user.avatar_url}" class="user-avatar-img" id="profile-avatar-preview" />
            ` : `
              <div class="user-avatar-placeholder" id="profile-avatar-preview">
                ${(this.user.display_name || this.user.username)[0].toUpperCase()}
              </div>
            `}
            <div class="avatar-edit-overlay">
              <svg viewBox="0 0 24 24" fill="none" style="width: 24px; height: 24px;"><path d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" stroke="currentColor"/><circle cx="12" cy="13" r="4" stroke="currentColor"/></svg>
            </div>
            <input type="file" id="avatar-file-input" accept="image/jpeg,image/png,image/webp,image/gif" style="display: none;" />
          </div>

          <div>
            <h3 style="font-family: var(--font-heading); font-size: 20px; font-weight: 700;">
              ${this.escapeHtml(this.user.display_name || this.user.username)}
            </h3>
            <span style="color: var(--accent-primary); font-weight: 600; font-size: 14px;">
              @${this.escapeHtml(this.user.username)}
            </span>
          </div>

          <p style="font-size: 13px; color: var(--text-secondary); max-width: 260px;">
            ${this.user.bio ? this.escapeHtml(this.user.bio) : 'No bio added yet.'}
          </p>

          <span style="font-size: 11px; color: var(--text-muted);">
            Member since ${SpendlyStore.formatDateTime(this.user.created_at)}
          </span>
        </div>

        <!-- Right: Settings Sections -->
        <div style="display: flex; flex-direction: column; gap: 24px;">
          <!-- 1. Display Name & Bio -->
          <div class="card">
            <h3 style="font-family: var(--font-heading); font-size: 18px; font-weight: 700; margin-bottom: 16px;">
              Personal Details
            </h3>
            <form id="edit-profile-form">
              <div class="form-group">
                <label class="form-label" for="profile-display-name">Full / Display Name</label>
                <input type="text" id="profile-display-name" class="form-input" value="${this.escapeHtml(this.user.display_name || '')}" placeholder="Your Name" />
              </div>
              <div class="form-group">
                <label class="form-label" for="profile-bio">Bio</label>
                <textarea id="profile-bio" class="form-textarea" rows="2" placeholder="A brief note about yourself">${this.escapeHtml(this.user.bio || '')}</textarea>
              </div>
              <button type="submit" class="btn btn-primary" id="save-profile-btn">
                Save Profile Details
              </button>
            </form>
          </div>

          <!-- 2. Change Username (30-day cooldown enforcement) -->
          <div class="card">
            <h3 style="font-family: var(--font-heading); font-size: 18px; font-weight: 700; margin-bottom: 8px;">
              Change Username
            </h3>
            <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 16px;">
              Usernames must be globally unique across Spendly. You can change your username a <strong>maximum of once every 30 days</strong>.
              Historical bills will preserve the historical username at the time of billing.
            </p>

            ${this.renderUsernameChangeSection()}
          </div>

          <!-- 3. Change Email (with OTP verification) -->
          <div class="card">
            <h3 style="font-family: var(--font-heading); font-size: 18px; font-weight: 700; margin-bottom: 8px;">
              Email Address
            </h3>
            <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 16px;">
              Current Email: <strong>${this.escapeHtml(this.user.email)}</strong>.
              Changing your email requires real-time 6-digit OTP verification on the new address.
            </p>
            <button class="btn btn-secondary" id="change-email-trigger-btn">
              Change Email Address
            </button>
          </div>

          <!-- 4. Change Password -->
          <div class="card">
            <h3 style="font-family: var(--font-heading); font-size: 18px; font-weight: 700; margin-bottom: 16px;">
              Security & Password
            </h3>
            <form id="change-password-form">
              <div class="form-group">
                <label class="form-label" for="current-password-input">Current Password</label>
                <input type="password" id="current-password-input" class="form-input" required autocomplete="current-password" />
              </div>
              <div class="form-group">
                <label class="form-label" for="new-password-input">New Password</label>
                <input type="password" id="new-password-input" class="form-input" minlength="6" placeholder="At least 6 characters" required autocomplete="new-password" />
              </div>
              <button type="submit" class="btn btn-secondary" id="save-password-btn">
                Update Password
              </button>
            </form>
          </div>

          <!-- 5. Danger Zone: Delete Account -->
          <div class="card danger-zone-card">
            <h3 style="font-family: var(--font-heading); font-size: 18px; font-weight: 700; color: var(--accent-danger); margin-bottom: 8px;">
              Danger Zone — Account Deletion
            </h3>
            <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 16px;">
              Permanently delete your Spendly account and personal expenses. You must complete any active billing obligations first.
              Historical group bills where other members depend on your past participation are preserved, and admin succession will apply.
            </p>
            <button class="btn btn-danger" id="delete-account-btn">
              Permanently Delete Account
            </button>
          </div>
        </div>
      </div>
    `;

    this.attachEvents();
  },

  renderUsernameChangeSection() {
    const lastChange = this.user.last_username_change;
    const cooldownMs = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    if (lastChange && now - lastChange < cooldownMs) {
      const remainingDays = Math.ceil((cooldownMs - (now - lastChange)) / (1000 * 60 * 60 * 24));
      return `
        <div style="background: var(--bg-primary); border: 1px solid var(--border-card); border-radius: var(--radius-md); padding: 14px; font-size: 13px; color: var(--text-muted);">
          ⏳ You changed your username recently. You can change it again in <strong>${remainingDays} day(s)</strong>.
        </div>
      `;
    }

    return `
      <form id="change-username-form" style="display: flex; gap: 10px; align-items: flex-start; flex-wrap: wrap;">
        <div style="flex: 1; min-width: 200px;">
          <input type="text" id="new-username-input" class="form-input" placeholder="New unique username" minlength="3" maxlength="30" required />
          <span id="uname-feedback" style="font-size: 11px; margin-top: 4px; display: block;"></span>
        </div>
        <button type="submit" class="btn btn-secondary" id="save-username-btn">
          Change Username
        </button>
      </form>
    `;
  },

  attachEvents() {
    // Logout
    const logoutBtn = document.getElementById('profile-logout-btn');
    if (logoutBtn) {
      logoutBtn.onclick = async () => {
        try {
          await SpendlyAPI.post('/auth/logout');
        } catch (err) {}
        SpendlyStore.setAuth(null, null);
        SpendlyApp.showToast({ type: 'info', title: 'Logged Out', message: 'You have been signed out.' });
        window.location.hash = '#/auth';
      };
    }

    // Avatar Upload Trigger
    const avatarTrigger = document.getElementById('avatar-upload-trigger');
    const avatarInput = document.getElementById('avatar-file-input');
    if (avatarTrigger && avatarInput) {
      avatarTrigger.onclick = () => avatarInput.click();
      avatarInput.onchange = async () => {
        if (!avatarInput.files || !avatarInput.files[0]) return;
        const file = avatarInput.files[0];
        const formData = new FormData();
        formData.append('avatar', file);

        try {
          SpendlyApp.showToast({ type: 'info', title: 'Uploading', message: 'Updating profile picture...' });
          const res = await SpendlyAPI.post('/auth/avatar', formData);
          SpendlyStore.setUser(res.user);
          SpendlyApp.showToast({ type: 'success', title: 'Updated', message: 'Profile picture updated!' });
          this.render();
        } catch (err) {
          SpendlyApp.showToast({ type: 'error', title: 'Upload Failed', message: err.message });
        }
      };
    }

    // Edit Profile Form
    const profileForm = document.getElementById('edit-profile-form');
    if (profileForm) {
      profileForm.onsubmit = async (e) => {
        e.preventDefault();
        const displayName = document.getElementById('profile-display-name').value.trim();
        const bio = document.getElementById('profile-bio').value.trim();

        try {
          const res = await SpendlyAPI.put('/auth/profile', { displayName, bio });
          SpendlyStore.setUser(res.user);
          SpendlyApp.showToast({ type: 'success', title: 'Profile Saved', message: 'Details updated successfully.' });
          this.render();
        } catch (err) {
          SpendlyApp.showToast({ type: 'error', title: 'Error', message: err.message });
        }
      };
    }

    // Change Username Form
    const unameForm = document.getElementById('change-username-form');
    if (unameForm) {
      const unameInput = document.getElementById('new-username-input');
      const feedback = document.getElementById('uname-feedback');

      let timeout;
      unameInput.oninput = () => {
        clearTimeout(timeout);
        const val = unameInput.value.trim();
        if (val.length < 3) {
          feedback.textContent = '';
          return;
        }
        timeout = setTimeout(async () => {
          try {
            const check = await SpendlyAPI.get(`/auth/check-username/${encodeURIComponent(val)}`);
            if (check.available) {
              feedback.textContent = '✓ Available';
              feedback.style.color = 'var(--accent-primary)';
            } else {
              feedback.textContent = '✗ Unavailable';
              feedback.style.color = 'var(--accent-danger)';
            }
          } catch (e) {}
        }, 300);
      };

      unameForm.onsubmit = async (e) => {
        e.preventDefault();
        const newUsername = unameInput.value.trim();

        SpendlyApp.showConfirmModal({
          title: 'Confirm Username Change',
          message: `Change username to @${newUsername}? You will not be able to change it again for 30 days.`,
          confirmText: 'Confirm Change',
          onConfirm: async (close) => {
            try {
              const res = await SpendlyAPI.post('/auth/change-username', { username: newUsername });
              const updatedUser = { ...this.user, username: res.username, last_username_change: Date.now() };
              SpendlyStore.setUser(updatedUser);
              SpendlyApp.showToast({ type: 'success', title: 'Username Updated', message: `Username is now @${res.username}` });
              close();
              this.render();
            } catch (err) {
              SpendlyApp.showToast({ type: 'error', title: 'Error', message: err.message });
            }
          }
        });
      };
    }

    // Change Email Trigger
    const changeEmailBtn = document.getElementById('change-email-trigger-btn');
    if (changeEmailBtn) {
      changeEmailBtn.onclick = () => this.showChangeEmailModal();
    }

    // Change Password Form
    const passwordForm = document.getElementById('change-password-form');
    if (passwordForm) {
      passwordForm.onsubmit = async (e) => {
        e.preventDefault();
        const currentPassword = document.getElementById('current-password-input').value;
        const newPassword = document.getElementById('new-password-input').value;

        try {
          await SpendlyAPI.post('/auth/change-password', { currentPassword, newPassword });
          SpendlyApp.showToast({ type: 'success', title: 'Success', message: 'Password changed successfully.' });
          passwordForm.reset();
        } catch (err) {
          SpendlyApp.showToast({ type: 'error', title: 'Password Error', message: err.message });
        }
      };
    }

    // Delete Account
    const deleteAccountBtn = document.getElementById('delete-account-btn');
    if (deleteAccountBtn) {
      deleteAccountBtn.onclick = () => {
        SpendlyApp.showConfirmModal({
          title: 'Permanently Delete Account?',
          message: 'This will permanently remove your account, active cycles, and personal data. Completed historical bills where other members depend on you will be preserved. This cannot be undone.',
          confirmText: 'Delete Forever',
          isDanger: true,
          onConfirm: async (close) => {
            try {
              await SpendlyAPI.delete('/auth/account');
              SpendlyApp.showToast({ type: 'info', title: 'Account Deleted', message: 'Your account has been permanently removed.' });
              close();
              SpendlyStore.setAuth(null, null);
              window.location.hash = '#/auth';
            } catch (err) {
              SpendlyApp.showToast({ type: 'error', title: 'Cannot Delete Account', message: err.message });
            }
          }
        });
      };
    }
  },

  showChangeEmailModal() {
    let step = 1;
    let newEmail = '';

    SpendlyApp.showModal({
      title: 'Change Email Address',
      renderBody: () => {
        if (step === 1) {
          return `
            <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 14px; line-height: 1.5;">
              Enter your new email address. A 6-digit verification code will be sent to confirm ownership.
            </p>
            <div class="form-group">
              <label class="form-label" for="new-email-input">New Email Address</label>
              <input type="email" id="new-email-input" class="form-input" placeholder="newemail@domain.com" required />
              <span id="new-email-error" style="color: var(--accent-danger); font-size: 12px; margin-top: 4px; display: none;"></span>
            </div>
          `;
        } else {
          return `
            <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 14px; line-height: 1.5;">
              Enter the 6-digit verification code sent to <strong>${newEmail}</strong>.
            </p>
            <div class="form-group">
              <label class="form-label" for="email-otp-input">6-Digit Verification Code</label>
              <input 
                type="text" 
                id="email-otp-input" 
                class="form-input" 
                placeholder="000000" 
                maxlength="6" 
                pattern="[0-9]{6}" 
                inputmode="numeric" 
                style="font-size: 22px; font-family: monospace; letter-spacing: 6px; text-align: center; font-weight: 700;"
                required 
              />
              <span id="email-otp-error" style="color: var(--accent-danger); font-size: 12px; margin-top: 4px; display: none;"></span>
            </div>
          `;
        }
      },
      confirmText: step === 1 ? 'Send Code' : 'Verify & Update Email',
      onConfirm: async (close) => {
        if (step === 1) {
          const input = document.getElementById('new-email-input');
          const errSpan = document.getElementById('new-email-error');
          if (!input || !input.value.trim()) {
            if (errSpan) {
              errSpan.textContent = 'Please enter a valid email address.';
              errSpan.style.display = 'block';
            }
            return;
          }
          const emailVal = input.value.trim();
          const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
          if (!emailRegex.test(emailVal) || !emailVal.includes('.') || emailVal.split('.').pop().length < 2) {
            if (errSpan) {
              errSpan.textContent = 'Please enter a valid email address.';
              errSpan.style.display = 'block';
            }
            return;
          }

          newEmail = emailVal;
          try {
            await SpendlyAPI.post('/auth/change-email-otp', { newEmail });
            step = 2;
            SpendlyApp.showToast({ type: 'info', title: 'Code Sent', message: `Verification code sent to ${newEmail}.` });
            this.showChangeEmailModal();
          } catch (err) {
            if (errSpan) {
              errSpan.textContent = err.message;
              errSpan.style.display = 'block';
            }
            SpendlyApp.showToast({ type: 'error', title: 'Error', message: err.message });
          }
        } else {
          const otpInput = document.getElementById('email-otp-input');
          const otpErr = document.getElementById('email-otp-error');
          const otp = otpInput ? otpInput.value.trim() : '';

          if (!otp || otp.length !== 6) {
            if (otpErr) {
              otpErr.textContent = 'Please enter a 6-digit code.';
              otpErr.style.display = 'block';
            }
            return;
          }

          try {
            const res = await SpendlyAPI.post('/auth/verify-change-email', { newEmail, otp });
            const updatedUser = { ...this.user, email: res.email };
            SpendlyStore.setUser(updatedUser);
            SpendlyApp.showToast({ type: 'success', title: 'Email Changed', message: `Email updated to ${res.email}.` });
            close();
            this.render();
          } catch (err) {
            if (otpErr) {
              otpErr.textContent = err.message;
              otpErr.style.display = 'block';
            }
            SpendlyApp.showToast({ type: 'error', title: 'Verification Failed', message: err.message });
          }
        }
      }
    });
  },

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
};

window.SpendlyProfileView = SpendlyProfileView;
