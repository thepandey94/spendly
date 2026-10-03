const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const { authenticate } = require('../middleware/auth');
const { uploadAvatar } = require('../middleware/upload');
const db = require('../db/database');

// 1. Request registration OTP
router.post('/register-otp', async (req, res) => {
  try {
    const { email } = req.body;
    const result = await authService.requestRegistrationOtp(email);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 2. Verify registration OTP and receive verification ticket
router.post('/verify-registration-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const result = await authService.verifyRegistrationOtp(email, otp);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 3. Register user (with verification ticket or direct OTP)
router.post('/register', async (req, res) => {
  try {
    const { email, verificationTicket, otp, username, password } = req.body;
    const deviceInfo = req.headers['user-agent'] || 'Web Device';
    const result = await authService.registerUser({ 
      email, 
      verificationTicket, 
      otp, 
      username, 
      password, 
      deviceInfo 
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 4. Login
router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    const deviceInfo = req.headers['user-agent'] || 'Web Device';
    const result = await authService.login({ identifier, password, deviceInfo });
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// 5. Logout
router.post('/logout', authenticate, async (req, res) => {
  try {
    // Find session id from token
    const session = await db.prepare('SELECT id FROM user_sessions WHERE token = ?').get(req.token);
    if (session) {
      await authService.logout(session.id);
    }
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Get current user
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// 7. Check username availability
router.get('/check-username/:username', async (req, res) => {
  const available = await authService.isUsernameAvailable(req.params.username);
  res.json({ available });
});

// 8. Search users
router.get('/search-users', authenticate, async (req, res) => {
  const query = req.query.q || '';
  const users = await authService.searchUsersByUsername(query, req.user.id);
  res.json({ users });
});

// 9. Forgot password: Request OTP
router.post('/forgot-password-otp', async (req, res) => {
  try {
    const { email } = req.body;
    const result = await authService.requestForgotPasswordOtp(email);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 10. Forgot password: Verify OTP and receive reset ticket
router.post('/verify-reset-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const result = await authService.verifyForgotPasswordOtp(email, otp);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 11. Reset password with ticket or OTP
router.post('/reset-password', async (req, res) => {
  try {
    const { email, resetTicket, otp, newPassword } = req.body;
    const result = await authService.resetPasswordWithOtp({ email, resetTicket, otp, newPassword });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 10. Change password from Profile
router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const result = await authService.changePassword(req.user.id, currentPassword, newPassword);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 11. Change username
router.post('/change-username', authenticate, async (req, res) => {
  try {
    const { username } = req.body;
    const result = await authService.changeUsername(req.user.id, username);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 12. Change email: Step 1 (Request OTP)
router.post('/change-email-otp', authenticate, async (req, res) => {
  try {
    const { newEmail } = req.body;
    const result = await authService.requestEmailChangeOtp(req.user.id, newEmail);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 13. Change email: Step 2 (Verify OTP)
router.post('/verify-change-email', authenticate, async (req, res) => {
  try {
    const { newEmail, otp } = req.body;
    const result = await authService.verifyEmailChange(req.user.id, newEmail, otp);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 14. Update profile info
router.put('/profile', authenticate, async (req, res) => {
  try {
    const { displayName, bio } = req.body;
    const updated = await authService.updateProfile(req.user.id, { displayName, bio });
    res.json({ user: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 15. Upload profile picture
router.post('/avatar', authenticate, uploadAvatar.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded.' });
    }
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    const updated = await authService.updateProfile(req.user.id, { avatarUrl });
    res.json({ user: updated, avatarUrl });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 16. Permanent account deletion
router.delete('/account', authenticate, async (req, res) => {
  try {
    const result = await authService.deleteAccount(req.user.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
