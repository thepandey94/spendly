const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/database');
const config = require('../config');
const emailService = require('./emailService');

/**
 * Strict RFC 5322 Email Validation
 */
function isValidEmail(email) {
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
}

/**
 * Check if a username is available globally (case-insensitive)
 */
async function isUsernameAvailable(username) {
  if (!username || typeof username !== 'string') return false;
  const cleanUsername = username.trim().toLowerCase();
  // Valid username regex: 3-30 chars, alphanumeric + underscores
  if (!/^[a-z0-9_]{3,30}$/.test(cleanUsername)) {
    return false;
  }
  const existing = await db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(cleanUsername);
  return !existing;
}

/**
 * Check if an email is already registered
 */
async function isEmailRegistered(email) {
  if (!email || typeof email !== 'string') return true;
  const cleanEmail = email.trim().toLowerCase();
  const existing = await db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(cleanEmail);
  return !!existing;
}

/**
 * Step 1 of Registration: Request OTP for email
 */
async function requestRegistrationOtp(email) {
  if (!isValidEmail(email)) {
    throw new Error('Please enter a valid email address.');
  }
  const cleanEmail = email.trim().toLowerCase();

  if (await isEmailRegistered(cleanEmail)) {
    throw new Error('An account with this email address already exists.');
  }

  return await emailService.sendOtp(cleanEmail, 'registration');
}

/**
 * Step 2 of Registration: Verify submitted OTP and return signed verificationTicket
 */
async function verifyRegistrationOtp(email, otp) {
  if (!isValidEmail(email)) {
    throw new Error('Please enter a valid email address.');
  }
  const cleanEmail = email.trim().toLowerCase();

  const otpResult = await emailService.verifyOtp(cleanEmail, otp, 'registration');
  if (!otpResult.success) {
    throw new Error(otpResult.error);
  }

  // Issue temporary signed ticket valid for 15 minutes
  const verificationTicket = jwt.sign(
    { email: cleanEmail, purpose: 'registration_verified' },
    config.JWT_SECRET,
    { expiresIn: '15m' }
  );

  return {
    success: true,
    message: 'Email Verified Successfully',
    verificationTicket
  };
}

/**
 * Step 3 of Registration: Create user account with verified ticket/OTP
 */
async function registerUser({ email, verificationTicket, otp, username, password, deviceInfo = 'Web Device' }) {
  if (!isValidEmail(email)) {
    throw new Error('Please enter a valid email address.');
  }
  const cleanEmail = email.trim().toLowerCase();
  const cleanUsername = (username || '').trim().toLowerCase();

  // Validate verification ticket or direct OTP
  if (verificationTicket) {
    try {
      const decoded = jwt.verify(verificationTicket, config.JWT_SECRET);
      if (decoded.email !== cleanEmail || decoded.purpose !== 'registration_verified') {
        throw new Error('Invalid verification ticket. Please verify your email again.');
      }
    } catch (err) {
      throw new Error('Verification has expired or is invalid. Please request a new code.');
    }
  } else if (otp) {
    const otpResult = await emailService.verifyOtp(cleanEmail, otp, 'registration');
    if (!otpResult.success) {
      throw new Error(otpResult.error);
    }
  } else {
    throw new Error('Email verification is required before creating an account.');
  }

  if (await isEmailRegistered(cleanEmail)) {
    throw new Error('An account with this email address already exists.');
  }

  if (!(await isUsernameAvailable(cleanUsername))) {
    throw new Error('Username is invalid or already taken. Must be 3-30 characters (letters, numbers, underscores).');
  }

  if (!password || password.length < 6) {
    throw new Error('Password must be at least 6 characters long.');
  }

  // Hash password
  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(password, salt);

  const userId = crypto.randomUUID();
  const now = Date.now();

  // Use transaction to create user and initial personal cycle
  await db.transaction(async () => {
    await db.prepare(`
      INSERT INTO users (id, email, username, password_hash, display_name, bio, avatar_url, last_username_change, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '', '', NULL, ?, ?)
    `).run(userId, cleanEmail, cleanUsername, passwordHash, cleanUsername, now, now);

    // Create initial active personal cycle (Cycle #1)
    const cycleId = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO personal_cycles (id, user_id, cycle_number, status, created_at)
      VALUES (?, ?, 1, 'active', ?)
    `).run(cycleId, userId, now);
  });

  // Generate session and token
  const token = jwt.sign({ userId, username: cleanUsername, email: cleanEmail }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN
  });

  const sessionId = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO user_sessions (id, user_id, device_info, token, created_at, last_active_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sessionId, userId, deviceInfo, token, now, now);

  const user = await db.prepare('SELECT id, email, username, display_name, bio, avatar_url, is_admin, last_username_change, created_at FROM users WHERE id = ?').get(userId);
  user.is_admin = Boolean(
    user.is_admin ||
    (config.ADMIN_EMAILS && config.ADMIN_EMAILS.includes((user.email || '').toLowerCase()))
  );

  return {
    user,
    token,
    sessionId
  };
}

/**
 * Login via Username OR Email + Password
 */
async function login({ identifier, password, deviceInfo = 'Web Device' }) {
  if (!identifier || !password) {
    throw new Error('Please provide username/email and password.');
  }

  const cleanIdentifier = identifier.trim().toLowerCase();

  const user = await db.prepare(`
    SELECT * FROM users 
    WHERE email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE
  `).get(cleanIdentifier, cleanIdentifier);

  if (!user) {
    throw new Error('Invalid credentials. Please check your username/email and password.');
  }

  const isPasswordValid = bcrypt.compareSync(password, user.password_hash);
  if (!isPasswordValid) {
    throw new Error('Invalid credentials. Please check your username/email and password.');
  }

  const token = jwt.sign({ userId: user.id, username: user.username, email: user.email }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN
  });

  const sessionId = crypto.randomUUID();
  const now = Date.now();

  await db.prepare(`
    INSERT INTO user_sessions (id, user_id, device_info, token, created_at, last_active_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sessionId, user.id, deviceInfo, token, now, now);

  const { password_hash, ...safeUser } = user;
  safeUser.is_admin = Boolean(
    user.is_admin ||
    (config.ADMIN_EMAILS && config.ADMIN_EMAILS.includes((user.email || '').toLowerCase()))
  );

  return {
    user: safeUser,
    token,
    sessionId
  };
}

/**
 * Logout specific session (does not affect other devices)
 */
async function logout(sessionId) {
  if (sessionId) {
    await db.prepare('DELETE FROM user_sessions WHERE id = ?').run(sessionId);
  }
  return { success: true };
}

/**
 * Forgot password: Step 1 Request OTP
 */
async function requestForgotPasswordOtp(email) {
  if (!isValidEmail(email)) {
    throw new Error('Please enter a valid email address.');
  }
  const cleanEmail = email.trim().toLowerCase();
  const user = await db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(cleanEmail);
  if (!user) {
    throw new Error('No Spendly account found with this email address.');
  }

  return await emailService.sendOtp(cleanEmail, 'reset_password');
}

/**
 * Forgot password: Step 2 Verify OTP and return signed resetTicket
 */
async function verifyForgotPasswordOtp(email, otp) {
  if (!isValidEmail(email)) {
    throw new Error('Please enter a valid email address.');
  }
  const cleanEmail = email.trim().toLowerCase();
  const otpResult = await emailService.verifyOtp(cleanEmail, otp, 'reset_password');
  if (!otpResult.success) {
    throw new Error(otpResult.error);
  }

  const resetTicket = jwt.sign(
    { email: cleanEmail, purpose: 'reset_password_verified' },
    config.JWT_SECRET,
    { expiresIn: '15m' }
  );

  return {
    success: true,
    message: 'Code verified successfully.',
    resetTicket
  };
}

/**
 * Forgot password: Step 3 Reset with verified resetTicket or OTP
 */
async function resetPasswordWithOtp({ email, resetTicket, otp, newPassword }) {
  if (!isValidEmail(email)) {
    throw new Error('Please enter a valid email address.');
  }
  const cleanEmail = email.trim().toLowerCase();
  if (!newPassword || newPassword.length < 6) {
    throw new Error('New password must be at least 6 characters long.');
  }

  if (resetTicket) {
    try {
      const decoded = jwt.verify(resetTicket, config.JWT_SECRET);
      if (decoded.email !== cleanEmail || decoded.purpose !== 'reset_password_verified') {
        throw new Error('Invalid reset ticket. Please request a new code.');
      }
    } catch (err) {
      throw new Error('Reset code has expired. Please request a new code.');
    }
  } else if (otp) {
    const otpResult = await emailService.verifyOtp(cleanEmail, otp, 'reset_password');
    if (!otpResult.success) {
      throw new Error(otpResult.error);
    }
  } else {
    throw new Error('Verification is required to reset your password.');
  }

  const user = await db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(cleanEmail);
  if (!user) {
    throw new Error('No Spendly account found with this email address.');
  }

  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(newPassword, salt);
  const now = Date.now();

  await db.prepare(`
    UPDATE users 
    SET password_hash = ?, updated_at = ? 
    WHERE id = ?
  `).run(passwordHash, now, user.id);

  // Revoke all existing sessions on password reset for security
  await db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(user.id);

  return { success: true, message: 'Password has been updated successfully. Please log in.' };
}

/**
 * Change password from inside Profile
 */
async function changePassword(userId, currentPassword, newPassword) {
  if (!newPassword || newPassword.length < 6) {
    throw new Error('New password must be at least 6 characters long.');
  }

  const user = await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
  if (!user) {
    throw new Error('User not found.');
  }

  const isValid = bcrypt.compareSync(currentPassword, user.password_hash);
  if (!isValid) {
    throw new Error('Current password is incorrect.');
  }

  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(newPassword, salt);
  const now = Date.now();

  await db.prepare(`
    UPDATE users 
    SET password_hash = ?, updated_at = ? 
    WHERE id = ?
  `).run(passwordHash, now, userId);

  return { success: true, message: 'Password changed successfully.' };
}

/**
 * Change username (maximum once per month)
 */
async function changeUsername(userId, newUsername) {
  const cleanUsername = newUsername.trim().toLowerCase();
  if (!(await isUsernameAvailable(cleanUsername))) {
    throw new Error('Username is invalid or already in use. Must be 3-30 alphanumeric characters.');
  }

  const user = await db.prepare('SELECT last_username_change FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('User not found.');

  const now = Date.now();
  if (user.last_username_change) {
    const elapsed = now - user.last_username_change;
    if (elapsed < config.USERNAME_CHANGE_COOLDOWN_MS) {
      const remainingDays = Math.ceil((config.USERNAME_CHANGE_COOLDOWN_MS - elapsed) / (1000 * 60 * 60 * 24));
      throw new Error(`Username can only be changed once every 30 days. Please wait ${remainingDays} more day(s).`);
    }
  }

  await db.prepare(`
    UPDATE users 
    SET username = ?, last_username_change = ?, updated_at = ? 
    WHERE id = ?
  `).run(cleanUsername, now, now, userId);

  return { success: true, username: cleanUsername };
}

/**
 * Step 1 of Email Change: Send OTP to new email
 */
async function requestEmailChangeOtp(userId, newEmail) {
  if (!isValidEmail(newEmail)) {
    throw new Error('Please enter a valid email address.');
  }
  const cleanEmail = newEmail.trim().toLowerCase();

  if (await isEmailRegistered(cleanEmail)) {
    throw new Error('This email address is already in use by another Spendly account.');
  }

  return await emailService.sendOtp(cleanEmail, 'change_email');
}

/**
 * Step 2 of Email Change: Verify OTP and update email
 */
async function verifyEmailChange(userId, newEmail, otp) {
  if (!isValidEmail(newEmail)) {
    throw new Error('Please enter a valid email address.');
  }
  const cleanEmail = newEmail.trim().toLowerCase();
  const otpResult = await emailService.verifyOtp(cleanEmail, otp, 'change_email');
  if (!otpResult.success) {
    throw new Error(otpResult.error);
  }

  const now = Date.now();
  await db.prepare(`
    UPDATE users 
    SET email = ?, updated_at = ? 
    WHERE id = ?
  `).run(cleanEmail, now, userId);

  return { success: true, email: cleanEmail };
}

/**
 * Update Profile (display_name, bio, avatar_url)
 */
async function updateProfile(userId, { displayName, bio, avatarUrl }) {
  const user = await db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('User not found.');

  const updates = [];
  const params = [];

  if (displayName !== undefined) {
    updates.push('display_name = ?');
    params.push(displayName.trim());
  }
  if (bio !== undefined) {
    updates.push('bio = ?');
    params.push(bio.trim());
  }
  if (avatarUrl !== undefined) {
    updates.push('avatar_url = ?');
    params.push(avatarUrl);
  }

  if (updates.length === 0) return { success: true };

  updates.push('updated_at = ?');
  params.push(Date.now());
  params.push(userId);

  await db.prepare(`
    UPDATE users 
    SET ${updates.join(', ')} 
    WHERE id = ?
  `).run(...params);

  const updatedUser = await db.prepare('SELECT id, email, username, display_name, bio, avatar_url, is_admin, last_username_change, created_at FROM users WHERE id = ?').get(userId);
  if (updatedUser) {
    updatedUser.is_admin = Boolean(
      updatedUser.is_admin ||
      (config.ADMIN_EMAILS && config.ADMIN_EMAILS.includes((updatedUser.email || '').toLowerCase()))
    );
  }
  return updatedUser;
}

/**
 * Get User by ID
 */
async function getUserById(userId) {
  const user = await db.prepare('SELECT id, email, username, display_name, bio, avatar_url, is_admin, last_username_change, created_at FROM users WHERE id = ?').get(userId);
  if (user) {
    user.is_admin = Boolean(
      user.is_admin ||
      (config.ADMIN_EMAILS && config.ADMIN_EMAILS.includes((user.email || '').toLowerCase()))
    );
  }
  return user;
}

/**
 * Search users by username for group invites
 */
async function searchUsersByUsername(query, currentUserId) {
  if (!query || query.trim().length < 2) return [];
  const pattern = `%${query.trim().toLowerCase()}%`;
  return await db.prepare(`
    SELECT id, username, display_name, avatar_url 
    FROM users 
    WHERE username LIKE ? AND id != ? 
    LIMIT 10
  `).all(pattern, currentUserId);
}

/**
 * Permanent Account Deletion (Section 58)
 * Checks active billing obligations, handles admin succession, preserves historical bills
 */
async function deleteAccount(userId) {
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('User not found.');

  // 1. Check if user has active personal cycle with unbilled expenses
  const activePersonalCycle = await db.prepare(`
    SELECT id FROM personal_cycles WHERE user_id = ? AND status = 'active'
  `).get(userId);

  if (activePersonalCycle) {
    const expenseRow = await db.prepare(`
      SELECT COUNT(*) as count FROM personal_expenses WHERE cycle_id = ?
    `).get(activePersonalCycle.id);
    const expenseCount = expenseRow ? expenseRow.count : 0;

    if (expenseCount > 0) {
      throw new Error('Please complete billing your active personal expenses cycle before deleting your account.');
    }
  }

  // 2. Check if user has active group memberships with unbilled expenses or pending settlements
  const activeMemberships = await db.prepare(`
    SELECT gm.group_id, g.name as group_name, gm.role 
    FROM group_members gm
    JOIN groups g ON g.id = gm.group_id
    WHERE gm.user_id = ? AND gm.status = 'active' AND g.deleted_at IS NULL
  `).all(userId);

  for (const m of activeMemberships) {
    // Check if group has active unbilled cycle with expenses
    const groupActiveCycle = await db.prepare(`
      SELECT id FROM group_cycles WHERE group_id = ? AND status = 'active'
    `).get(m.group_id);

    if (groupActiveCycle) {
      const groupExpRow = await db.prepare(`
        SELECT COUNT(*) as count FROM group_expenses WHERE cycle_id = ?
      `).get(groupActiveCycle.id);
      const groupExpCount = groupExpRow ? groupExpRow.count : 0;

      if (groupExpCount > 0) {
        throw new Error(`Please complete billing in group "${m.group_name}" before deleting your account.`);
      }
    }

    // Check if user has unconfirmed pending settlements in this group
    const pendingSettlement = await db.prepare(`
      SELECT id FROM settlements 
      WHERE group_id = ? AND (payer_id = ? OR receiver_id = ?) AND status != 'completed'
    `).get(m.group_id, userId, userId);

    if (pendingSettlement) {
      throw new Error(`You have pending settlements in group "${m.group_name}". Please settle and confirm them before deleting your account.`);
    }
  }

  // 3. Apply Admin Succession & Account Deletion Transaction
  await db.transaction(async () => {
    // For every group where this user is admin:
    const adminGroups = await db.prepare(`
      SELECT id FROM groups WHERE admin_id = ? AND deleted_at IS NULL
    `).all(userId);

    for (const g of adminGroups) {
      // Find the first member originally added by that admin (lowest order_index)
      const successor = await db.prepare(`
        SELECT user_id FROM group_members 
        WHERE group_id = ? AND user_id != ? AND status = 'active' 
        ORDER BY order_index ASC 
        LIMIT 1
      `).get(g.id, userId);

      if (successor) {
        // Appoint successor as admin
        await db.prepare('UPDATE groups SET admin_id = ?, updated_at = ? WHERE id = ?').run(successor.user_id, Date.now(), g.id);
        await db.prepare('UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?').run('admin', g.id, successor.user_id);
      } else {
        // No other members in group; mark group as deleted
        await db.prepare('UPDATE groups SET deleted_at = ?, updated_at = ? WHERE id = ?').run(Date.now(), Date.now(), g.id);
      }
    }

    // Remove user from active group memberships
    await db.prepare(`
      UPDATE group_members SET status = 'left' WHERE user_id = ?
    `).run(userId);

    // Delete personal private data
    await db.prepare('DELETE FROM user_hidden_bills WHERE user_id = ?').run(userId);
    await db.prepare('DELETE FROM personal_expenses WHERE user_id = ?').run(userId);
    await db.prepare('DELETE FROM personal_expense_heads WHERE user_id = ?').run(userId);
    await db.prepare('DELETE FROM personal_bills WHERE user_id = ?').run(userId);
    await db.prepare('DELETE FROM personal_cycles WHERE user_id = ?').run(userId);

    // Delete sessions, push subscriptions, invitations, notifications
    await db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(userId);
    await db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId);
    await db.prepare('DELETE FROM group_invitations WHERE inviter_id = ? OR invitee_id = ?').run(userId, userId);
    await db.prepare('DELETE FROM notifications WHERE user_id = ?').run(userId);

    // Delete user record itself
    await db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });

  return { success: true, message: 'Account and personal data have been permanently deleted.' };
}

module.exports = {
  isUsernameAvailable,
  isEmailRegistered,
  requestRegistrationOtp,
  verifyRegistrationOtp,
  registerUser,
  login,
  logout,
  requestForgotPasswordOtp,
  verifyForgotPasswordOtp,
  resetPasswordWithOtp,
  changePassword,
  changeUsername,
  requestEmailChangeOtp,
  verifyEmailChange,
  updateProfile,
  getUserById,
  searchUsersByUsername,
  deleteAccount
};
