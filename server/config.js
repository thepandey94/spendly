const path = require('path');
require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  JWT_SECRET: process.env.JWT_SECRET || 'spendly_super_secure_jwt_secret_key_2026_prod',
  JWT_EXPIRES_IN: '30d',
  UPLOAD_DIR: process.env.UPLOAD_DIR || path.join(__dirname, '../uploads/avatars'),
  DB_PATH: process.env.DB_PATH || path.join(__dirname, 'spendly.db'),
  
  // Brevo SMTP Email configuration (Transactional OTP Delivery)
  SMTP_HOST: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
  SMTP_PORT: parseInt(process.env.SMTP_PORT, 10) || 587,
  SMTP_USER: process.env.SMTP_USER || process.env.BREVO_SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || process.env.BREVO_SMTP_KEY || '',
  SMTP_FROM: process.env.SMTP_FROM || process.env.BREVO_SENDER || '',
  BREVO_API_KEY: process.env.BREVO_API_KEY || '',
  
  // Web Push VAPID keys (can be configured or generated)
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || '',
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || '',
  VAPID_SUBJECT: process.env.VAPID_SUBJECT || 'mailto:support@spendly.app',

  // System constraints
  MAX_GROUP_MEMBERS: 50,
  MAX_PERSONAL_CYCLE_ENTRIES: 10000,
  OTP_EXPIRATION_MS: 10 * 60 * 1000, // 10 minutes
  MAX_OTP_ATTEMPTS: 5,
  OTP_RESEND_COOLDOWN_MS: 60 * 1000, // 60 seconds between resend requests
  OTP_RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000, // 15 minutes window
  MAX_OTP_REQUESTS_PER_WINDOW: 5,
  USERNAME_CHANGE_COOLDOWN_MS: 30 * 24 * 60 * 60 * 1000 // 30 days
};
