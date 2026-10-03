/**
 * Spendly Authentication View
 * Implements Real Registration with Email OTP Verification, Login (Username or Email), and Forgot Password
 */
const SpendlyAuthView = {
  activeTab: 'login', // 'login' | 'register'
  registerStep: 1,    // 1: email, 2: verify otp, 3: username & password
  pendingEmail: '',
  verificationTicket: null,
  resendTimer: 0,
  timerInterval: null,

  // Strict RFC-compliant frontend email validator
  isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const trimmed = email.trim();
    if (trimmed.length > 254) return false;
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
    if (!emailRegex.test(trimmed)) return false;
    const parts = trimmed.split('@');
    if (parts.length !== 2) return false;
    const domain = parts[1];
    if (!domain.includes('.')) return false;
    const tld = domain.split('.').pop();
    if (!tld || tld.length < 2) return false;
    return true;
  },

  startResendTimer(seconds = 60) {
    this.resendTimer = seconds;
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      this.resendTimer--;
      const resendBtn = document.getElementById('reg-resend-btn');
      if (resendBtn) {
        if (this.resendTimer > 0) {
          resendBtn.disabled = true;
          resendBtn.textContent = `Resend code in ${this.resendTimer}s`;
        } else {
          resendBtn.disabled = false;
          resendBtn.textContent = 'Resend Code';
          clearInterval(this.timerInterval);
          this.timerInterval = null;
        }
      } else {
        if (this.resendTimer <= 0) {
          clearInterval(this.timerInterval);
          this.timerInterval = null;
        }
      }
    }, 1000);
  },

  render() {
    const container = document.getElementById('main-view-container');
    container.innerHTML = `
      <div class="auth-container">
        <div class="auth-card">
          <div class="auth-brand">
            <div class="brand-logo">
              <div class="logo-icon">₹</div>
              <span>Spendly</span>
            </div>
            <p class="brand-tagline">Real-time collaborative & personal expense tracking</p>
          </div>

          <div class="auth-tabs">
            <button class="auth-tab-btn ${this.activeTab === 'login' ? 'active' : ''}" id="tab-login-btn">Log In</button>
            <button class="auth-tab-btn ${this.activeTab === 'register' ? 'active' : ''}" id="tab-register-btn">Create Account</button>
          </div>

          <div id="auth-form-container">
            ${this.activeTab === 'login' ? this.renderLoginForm() : this.renderRegisterForm()}
          </div>
        </div>
      </div>
    `;

    this.attachEvents();
  },

  renderLoginForm() {
    return `
      <form id="login-form">
        <div class="form-group">
          <label class="form-label" for="login-identifier">Username or Email</label>
          <input type="text" id="login-identifier" class="form-input" placeholder="e.g. rahul_dev or rahul@example.com" required autocomplete="username" />
        </div>

        <div class="form-group">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <label class="form-label" for="login-password" style="margin-bottom: 0;">Password</label>
            <a href="javascript:void(0)" id="forgot-password-link" style="font-size: 12px; font-weight: 500;">Forgot password?</a>
          </div>
          <input type="password" id="login-password" class="form-input" placeholder="Enter your password" required autocomplete="current-password" />
        </div>

        <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 10px;" id="login-submit-btn">
          Sign In to Spendly
        </button>
      </form>
    `;
  },

  renderRegisterForm() {
    // Step 1: Enter Email
    if (this.registerStep === 1) {
      return `
        <form id="register-step1-form">
          <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 16px; line-height: 1.5;">
            Enter your email to receive a 6-digit verification code.
          </p>

          <div class="form-group">
            <label class="form-label" for="reg-email">Email Address</label>
            <input type="email" id="reg-email" class="form-input" placeholder="name@domain.com" value="${this.pendingEmail || ''}" required autocomplete="email" />
            <span id="reg-email-error" style="color: var(--accent-danger); font-size: 12px; margin-top: 4px; display: none;"></span>
          </div>

          <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 10px;" id="reg-send-otp-btn">
            Send Verification Code
          </button>
        </form>
      `;
    }

    // Step 2: Verify Your Email (OTP Input & Resend)
    if (this.registerStep === 2) {
      return `
        <form id="register-step2-form">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
            <span style="font-size: 13px; color: var(--text-secondary);">
              Verifying: <strong style="color: var(--text-primary);">${this.pendingEmail}</strong>
            </span>
            <a href="javascript:void(0)" id="reg-change-email-btn" style="font-size: 12px; font-weight: 500;">Change</a>
          </div>

          <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 16px; line-height: 1.5;">
            A verification code has been sent to your email.
          </p>

          <div class="form-group">
            <label class="form-label" for="reg-otp">6-Digit Verification Code</label>
            <input 
              type="text" 
              id="reg-otp" 
              class="form-input" 
              placeholder="000000" 
              maxlength="6" 
              pattern="[0-9]{6}" 
              inputmode="numeric" 
              autocomplete="one-time-code"
              style="font-size: 24px; font-family: monospace; letter-spacing: 8px; text-align: center; font-weight: 700;"
              required 
            />
            <span id="reg-otp-error" style="color: var(--accent-danger); font-size: 12px; margin-top: 4px; display: none;"></span>
          </div>

          <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 10px;" id="reg-verify-btn">
            Verify Code
          </button>

          <div style="text-align: center; margin-top: 18px;">
            <button 
              type="button" 
              class="btn btn-link" 
              id="reg-resend-btn" 
              style="font-size: 13px; color: var(--text-muted); padding: 4px 8px;"
              ${this.resendTimer > 0 ? 'disabled' : ''}
            >
              ${this.resendTimer > 0 ? `Resend code in ${this.resendTimer}s` : 'Resend Code'}
            </button>
          </div>
        </form>
      `;
    }

    // Step 3: Enter Username & Password (Only after successful verification)
    return `
      <form id="register-step3-form">
        <div style="display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: var(--radius-md); margin-bottom: 18px; color: var(--accent-primary); font-size: 13px; font-weight: 500;">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>Email Verified: <strong>${this.pendingEmail}</strong></span>
        </div>

        <div class="form-group">
          <label class="form-label" for="reg-username">Choose a Unique Username</label>
          <input type="text" id="reg-username" class="form-input" placeholder="e.g. rahul456" minlength="3" maxlength="30" required autocomplete="username" />
          <span id="username-avail-feedback" style="font-size: 11px; margin-top: 4px;"></span>
        </div>

        <div class="form-group">
          <label class="form-label" for="reg-password">Create Password</label>
          <input type="password" id="reg-password" class="form-input" placeholder="At least 6 characters" minlength="6" required autocomplete="new-password" />
        </div>

        <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 10px;" id="reg-complete-btn">
          Create Spendly Account
        </button>
      </form>
    `;
  },

  attachEvents() {
    const tabLogin = document.getElementById('tab-login-btn');
    const tabRegister = document.getElementById('tab-register-btn');

    if (tabLogin) {
      tabLogin.onclick = () => {
        this.activeTab = 'login';
        this.render();
      };
    }

    if (tabRegister) {
      tabRegister.onclick = () => {
        this.activeTab = 'register';
        this.registerStep = 1;
        this.render();
      };
    }

    // Login Form Submit
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.onsubmit = async (e) => {
        e.preventDefault();
        const identifier = document.getElementById('login-identifier').value.trim();
        const password = document.getElementById('login-password').value;
        const submitBtn = document.getElementById('login-submit-btn');

        try {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Signing in...';

          const res = await SpendlyAPI.post('/auth/login', { identifier, password });
          SpendlyStore.setAuth(res.user, res.token);
          SpendlyApp.showToast({ type: 'success', title: 'Welcome back!', message: `Logged in as @${res.user.username}` });
          window.location.hash = '#/own-expenses';
        } catch (err) {
          SpendlyApp.showToast({ type: 'error', title: 'Login Failed', message: err.message });
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Sign In to Spendly';
        }
      };
    }

    // Forgot Password Link
    const forgotLink = document.getElementById('forgot-password-link');
    if (forgotLink) {
      forgotLink.onclick = () => this.showForgotPasswordDialog();
    }

    // Register Step 1: Send OTP
    const regStep1 = document.getElementById('register-step1-form');
    if (regStep1) {
      regStep1.onsubmit = async (e) => {
        e.preventDefault();
        const emailInput = document.getElementById('reg-email');
        const emailError = document.getElementById('reg-email-error');
        const email = emailInput.value.trim();
        const btn = document.getElementById('reg-send-otp-btn');

        // Frontend validation
        if (!this.isValidEmail(email)) {
          emailError.textContent = 'Please enter a valid email address.';
          emailError.style.display = 'block';
          emailInput.focus();
          SpendlyApp.showToast({ type: 'error', title: 'Invalid Email', message: 'Please enter a valid email address.' });
          return;
        }
        emailError.style.display = 'none';

        try {
          btn.disabled = true;
          btn.textContent = 'Sending Verification Code...';

          await SpendlyAPI.post('/auth/register-otp', { email });
          this.pendingEmail = email;
          this.registerStep = 2;
          this.startResendTimer(60);
          SpendlyApp.showToast({ 
            type: 'info', 
            title: 'Verification Code Sent', 
            message: `A 6-digit code has been sent to ${email}.` 
          });
          this.render();
        } catch (err) {
          emailError.textContent = err.message;
          emailError.style.display = 'block';
          SpendlyApp.showToast({ type: 'error', title: 'Registration Error', message: err.message });
        } finally {
          if (btn) {
            btn.disabled = false;
            btn.textContent = 'Send Verification Code';
          }
        }
      };
    }

    // Register Step 2: Verify OTP
    const regStep2 = document.getElementById('register-step2-form');
    if (regStep2) {
      const changeEmailBtn = document.getElementById('reg-change-email-btn');
      if (changeEmailBtn) {
        changeEmailBtn.onclick = () => {
          this.registerStep = 1;
          this.render();
        };
      }

      const resendBtn = document.getElementById('reg-resend-btn');
      if (resendBtn) {
        resendBtn.onclick = async () => {
          if (this.resendTimer > 0) return;
          try {
            resendBtn.disabled = true;
            resendBtn.textContent = 'Sending...';
            await SpendlyAPI.post('/auth/register-otp', { email: this.pendingEmail });
            this.startResendTimer(60);
            SpendlyApp.showToast({ type: 'info', title: 'Code Resent', message: 'A new verification code has been sent to your email.' });
          } catch (err) {
            SpendlyApp.showToast({ type: 'error', title: 'Resend Failed', message: err.message });
            resendBtn.disabled = false;
            resendBtn.textContent = 'Resend Code';
          }
        };
      }

      regStep2.onsubmit = async (e) => {
        e.preventDefault();
        const otpInput = document.getElementById('reg-otp');
        const otpError = document.getElementById('reg-otp-error');
        const otp = otpInput.value.trim();
        const btn = document.getElementById('reg-verify-btn');

        if (!otp || otp.length !== 6 || !/^\d{6}$/.test(otp)) {
          otpError.textContent = 'Please enter a 6-digit code.';
          otpError.style.display = 'block';
          return;
        }
        otpError.style.display = 'none';

        try {
          btn.disabled = true;
          btn.textContent = 'Verifying Code...';

          const res = await SpendlyAPI.post('/auth/verify-registration-otp', {
            email: this.pendingEmail,
            otp
          });

          this.verificationTicket = res.verificationTicket;
          this.registerStep = 3;
          SpendlyApp.showToast({ type: 'success', title: 'Verified', message: 'Email verified successfully!' });
          this.render();
        } catch (err) {
          otpError.textContent = err.message;
          otpError.style.display = 'block';
          SpendlyApp.showToast({ type: 'error', title: 'Verification Failed', message: err.message });
        } finally {
          if (btn) {
            btn.disabled = false;
            btn.textContent = 'Verify Code';
          }
        }
      };
    }

    // Register Step 3: Choose Username & Password
    const regStep3 = document.getElementById('register-step3-form');
    if (regStep3) {
      const usernameInput = document.getElementById('reg-username');
      let timeout = null;
      usernameInput.oninput = () => {
        clearTimeout(timeout);
        const feedback = document.getElementById('username-avail-feedback');
        const val = usernameInput.value.trim();
        if (val.length < 3) {
          feedback.textContent = 'Username must be at least 3 characters.';
          feedback.style.color = 'var(--text-muted)';
          return;
        }
        timeout = setTimeout(async () => {
          try {
            const check = await SpendlyAPI.get(`/auth/check-username/${encodeURIComponent(val)}`);
            if (check.available) {
              feedback.textContent = '✓ Username is available';
              feedback.style.color = 'var(--accent-primary)';
            } else {
              feedback.textContent = '✗ Username is already taken or invalid';
              feedback.style.color = 'var(--accent-danger)';
            }
          } catch (err) {
            // ignore
          }
        }, 300);
      };

      regStep3.onsubmit = async (e) => {
        e.preventDefault();
        const username = usernameInput.value.trim();
        const password = document.getElementById('reg-password').value;
        const btn = document.getElementById('reg-complete-btn');

        try {
          btn.disabled = true;
          btn.textContent = 'Creating account...';

          const res = await SpendlyAPI.post('/auth/register', {
            email: this.pendingEmail,
            verificationTicket: this.verificationTicket,
            username,
            password
          });

          SpendlyStore.setAuth(res.user, res.token);
          SpendlyApp.showToast({ type: 'success', title: 'Account Created', message: `Welcome to Spendly, @${res.user.username}!` });
          window.location.hash = '#/own-expenses';
        } catch (err) {
          SpendlyApp.showToast({ type: 'error', title: 'Registration Failed', message: err.message });
        } finally {
          if (btn) {
            btn.disabled = false;
            btn.textContent = 'Create Spendly Account';
          }
        }
      };
    }
  },

  showForgotPasswordDialog() {
    let fpStep = 1; // 1: email, 2: otp, 3: new password
    let fpEmail = '';
    let fpResetTicket = null;

    const renderModalContent = () => {
      if (fpStep === 1) {
        return `
          <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 14px; line-height: 1.5;">
            Enter your registered Spendly email address. We will send a 6-digit verification code to reset your password.
          </p>
          <div class="form-group">
            <label class="form-label" for="fp-email">Email Address</label>
            <input type="email" id="fp-email" class="form-input" placeholder="name@domain.com" value="${fpEmail}" required />
            <span id="fp-email-error" style="color: var(--accent-danger); font-size: 12px; margin-top: 4px; display: none;"></span>
          </div>
        `;
      } else if (fpStep === 2) {
        return `
          <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 14px; line-height: 1.5;">
            Enter the 6-digit verification code sent to <strong>${fpEmail}</strong>.
          </p>
          <div class="form-group">
            <label class="form-label" for="fp-otp">6-Digit Verification Code</label>
            <input 
              type="text" 
              id="fp-otp" 
              class="form-input" 
              placeholder="000000" 
              maxlength="6" 
              pattern="[0-9]{6}" 
              inputmode="numeric" 
              style="font-size: 22px; font-family: monospace; letter-spacing: 6px; text-align: center; font-weight: 700;"
              required 
            />
            <span id="fp-otp-error" style="color: var(--accent-danger); font-size: 12px; margin-top: 4px; display: none;"></span>
          </div>
        `;
      } else {
        return `
          <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 14px; line-height: 1.5;">
            Set a new secure password for your Spendly account (at least 6 characters).
          </p>
          <div class="form-group">
            <label class="form-label" for="fp-new-password">New Password</label>
            <input type="password" id="fp-new-password" class="form-input" placeholder="At least 6 characters" minlength="6" required autocomplete="new-password" />
          </div>
        `;
      }
    };

    SpendlyApp.showModal({
      title: 'Reset Password',
      renderBody: renderModalContent,
      confirmText: fpStep === 1 ? 'Send Code' : fpStep === 2 ? 'Verify Code' : 'Update Password',
      onConfirm: async (close) => {
        if (fpStep === 1) {
          const emailInput = document.getElementById('fp-email');
          const emailErr = document.getElementById('fp-email-error');
          if (!emailInput || !emailInput.value.trim()) {
            emailErr.textContent = 'Please enter your email.';
            emailErr.style.display = 'block';
            return;
          }
          const email = emailInput.value.trim();
          if (!this.isValidEmail(email)) {
            emailErr.textContent = 'Please enter a valid email address.';
            emailErr.style.display = 'block';
            return;
          }

          fpEmail = email;
          try {
            await SpendlyAPI.post('/auth/forgot-password-otp', { email: fpEmail });
            fpStep = 2;
            SpendlyApp.showToast({ type: 'info', title: 'Code Sent', message: 'A verification code has been sent to your email.' });
            // Re-render modal in step 2
            this.showForgotPasswordDialog();
          } catch (err) {
            emailErr.textContent = err.message;
            emailErr.style.display = 'block';
            SpendlyApp.showToast({ type: 'error', title: 'Reset Error', message: err.message });
          }
        } else if (fpStep === 2) {
          const otpInput = document.getElementById('fp-otp');
          const otpErr = document.getElementById('fp-otp-error');
          const otp = otpInput ? otpInput.value.trim() : '';

          if (!otp || otp.length !== 6) {
            otpErr.textContent = 'Please enter a valid 6-digit code.';
            otpErr.style.display = 'block';
            return;
          }

          try {
            const res = await SpendlyAPI.post('/auth/verify-reset-otp', { email: fpEmail, otp });
            fpResetTicket = res.resetTicket;
            fpStep = 3;
            SpendlyApp.showToast({ type: 'success', title: 'Code Verified', message: 'Enter your new password.' });
            this.showForgotPasswordDialog();
          } catch (err) {
            otpErr.textContent = err.message;
            otpErr.style.display = 'block';
            SpendlyApp.showToast({ type: 'error', title: 'Verification Failed', message: err.message });
          }
        } else {
          const newPassInput = document.getElementById('fp-new-password');
          const newPassword = newPassInput ? newPassInput.value : '';

          if (!newPassword || newPassword.length < 6) {
            SpendlyApp.showToast({ type: 'error', title: 'Error', message: 'Password must be at least 6 characters long.' });
            return;
          }

          try {
            await SpendlyAPI.post('/auth/reset-password', {
              email: fpEmail,
              resetTicket: fpResetTicket,
              newPassword
            });
            SpendlyApp.showToast({ type: 'success', title: 'Password Reset', message: 'Your password has been reset successfully. You can now log in.' });
            close();
          } catch (err) {
            SpendlyApp.showToast({ type: 'error', title: 'Reset Error', message: err.message });
          }
        }
      }
    });
  }
};

window.SpendlyAuthView = SpendlyAuthView;
