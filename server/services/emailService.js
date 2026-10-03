const nodemailer = require('nodemailer');
const crypto = require('crypto');
const https = require('https');
const config = require('../config');
const db = require('../db/database');

let cachedTransporter = null;

// Sliding window tracker for email OTP rate limiting: email -> [timestamps]
const emailRequestTimestamps = new Map();

/**
 * Parse sender name and email from "Name <email@domain.com>" or "email@domain.com"
 */
function parseSender(fromStr) {
  if (!fromStr || typeof fromStr !== 'string') {
    return { name: 'Spendly', email: '' };
  }
  const match = fromStr.match(/^(?:["']?([^"']+)["']?\s*)?<([^>]+)>$/);
  if (match) {
    return { name: match[1]?.trim() || 'Spendly', email: match[2]?.trim() };
  }
  return { name: 'Spendly', email: fromStr.trim() };
}

/**
 * Get effective verified sender address for Brevo delivery.
 * Brevo requires that the "From" address match a verified sender email in your Brevo account.
 */
function getEffectiveSender() {
  const from = (config.SMTP_FROM || '').trim();
  // If SMTP_FROM is not configured or still uses the unverified placeholder
  if (!from || from.includes('noreply@spendly.app')) {
    // If SMTP_USER is an email address, that is the primary Brevo verified sender
    if (config.SMTP_USER && config.SMTP_USER.includes('@')) {
      return `Spendly <${config.SMTP_USER.trim()}>`;
    }
  }
  return from || (config.SMTP_USER && config.SMTP_USER.includes('@') ? `Spendly <${config.SMTP_USER.trim()}>` : 'Spendly <noreply@spendly.app>');
}

/**
 * Initialize or retrieve the active Brevo SMTP Nodemailer transporter.
 * Strictly uses Brevo SMTP (smtp-relay.brevo.com:587).
 * No Ethereal fallback.
 */
function getTransporter() {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  const smtpUser = config.SMTP_USER;
  const smtpPass = config.SMTP_PASS;

  if (!smtpUser || !smtpPass) {
    throw new Error(
      'Brevo SMTP is not configured. Please set SMTP_USER and SMTP_PASS in your .env file with your Brevo credentials.'
    );
  }

  const host = config.SMTP_HOST || 'smtp-relay.brevo.com';
  const port = config.SMTP_PORT || 587;
  const isSecure = port === 465;

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure: isSecure,
    auth: {
      user: smtpUser,
      pass: smtpPass
    },
    tls: {
      rejectUnauthorized: true
    }
  });

  console.log(`[Spendly EmailService] Configured Brevo SMTP relay (${host}:${port}) with user: ${smtpUser}`);
  return cachedTransporter;
}

/**
 * Optional Brevo REST API v3 fallback if BREVO_API_KEY is provided or if port 587 is blocked
 */
async function sendViaBrevoApi({ to, subject, html, text }) {
  const apiKey = config.BREVO_API_KEY || (config.SMTP_PASS && config.SMTP_PASS.startsWith('xkeysib-') ? config.SMTP_PASS : '');
  if (!apiKey) {
    throw new Error('Valid Brevo API key not found for REST API delivery.');
  }

  const senderObj = parseSender(getEffectiveSender());
  if (!senderObj.email || senderObj.email.includes('noreply@spendly.app')) {
    throw new Error('A verified sender email in your Brevo account is required for Brevo delivery.');
  }

  const payload = JSON.stringify({
    sender: senderObj,
    to: [{ email: to }],
    subject,
    htmlContent: html,
    textContent: text || subject
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      'https://api.brevo.com/v3/smtp/email',
      {
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 15000
      },
      (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = JSON.parse(body);
              resolve({ messageId: parsed.messageId });
            } catch (e) {
              resolve({ messageId: 'brevo-api-ok' });
            }
          } else {
            reject(new Error(`Brevo API Error (${res.statusCode}): ${body}`));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Brevo API request timed out after 15 seconds.'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Compute secure HMAC-SHA256 hash of the OTP for safe database storage
 */
function hashOtp(email, otpCode) {
  return crypto.createHmac('sha256', config.JWT_SECRET)
    .update(`${email.trim().toLowerCase()}:${otpCode.trim()}`)
    .digest('hex');
}

/**
 * Generate a cryptographically secure 6-digit numeric OTP
 */
function generateOtp() {
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * Check rate limit and resend cooldown for an email
 */
function checkRateLimitAndCooldown(email, purpose) {
  const now = Date.now();
  const normalizedEmail = email.trim().toLowerCase();

  // 1. Check Resend Cooldown against database record
  const existing = db.prepare(`
    SELECT created_at FROM email_otps 
    WHERE email = ? AND purpose = ?
  `).get(normalizedEmail, purpose);

  if (existing) {
    const elapsed = now - existing.created_at;
    if (elapsed < config.OTP_RESEND_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((config.OTP_RESEND_COOLDOWN_MS - elapsed) / 1000);
      throw new Error(`Please wait ${waitSeconds} seconds before requesting a new verification code.`);
    }
  }

  // 2. Check Sliding Window Rate Limit (e.g. max 5 requests per 15 mins)
  const timestamps = emailRequestTimestamps.get(normalizedEmail) || [];
  const validTimestamps = timestamps.filter(ts => now - ts < config.OTP_RATE_LIMIT_WINDOW_MS);

  if (validTimestamps.length >= config.MAX_OTP_REQUESTS_PER_WINDOW) {
    throw new Error('Too many verification requests. Please try again later.');
  }

  validTimestamps.push(now);
  emailRequestTimestamps.set(normalizedEmail, validTimestamps);
}

/**
 * Send real OTP for a given purpose ('registration', 'reset_password', 'change_email')
 * Delivered via Brevo SMTP relay or Brevo REST API v3 directly to the user's actual email inbox.
 */
async function sendOtp(email, purpose) {
  const normalizedEmail = email.trim().toLowerCase();

  // Validate rate limit & cooldown
  checkRateLimitAndCooldown(normalizedEmail, purpose);

  const otpCode = generateOtp();
  const hashedCode = hashOtp(normalizedEmail, otpCode);
  const now = Date.now();
  const expiresAt = now + config.OTP_EXPIRATION_MS;

  // Clean up any existing active OTPs for this email and purpose
  db.prepare(`
    DELETE FROM email_otps 
    WHERE email = ? AND purpose = ?
  `).run(normalizedEmail, purpose);

  // Insert newly hashed OTP into database
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO email_otps (id, email, otp_code, purpose, attempts, expires_at, created_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `).run(id, normalizedEmail, hashedCode, purpose, expiresAt, now);

  const subject = purpose === 'registration' 
    ? 'Your Spendly Verification Code' 
    : purpose === 'reset_password' 
      ? 'Reset Your Spendly Password' 
      : 'Verify Your New Spendly Email';

  const purposeTitle = purpose === 'registration'
    ? 'Welcome to Spendly'
    : purpose === 'reset_password'
      ? 'Password Reset Request'
      : 'Update Email Address';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; background: #0b0f19; color: #f8fafc; padding: 36px; border-radius: 16px; border: 1px solid #1e293b; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
      <div style="display: flex; align-items: center; margin-bottom: 24px;">
        <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #10b981, #047857); border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; font-size: 22px; color: #ffffff; margin-right: 12px; text-align: center; line-height: 40px;">₹</div>
        <span style="font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">Spendly</span>
      </div>
      <h2 style="color: #f1f5f9; margin-top: 0; font-size: 20px; font-weight: 600;">${purposeTitle}</h2>
      <p style="font-size: 15px; color: #94a3b8; line-height: 1.6;">Use the following 6-digit verification code to complete your verification:</p>
      <div style="background: #111827; border: 1px solid #1e293b; padding: 20px; border-radius: 12px; text-align: center; margin: 28px 0;">
        <span style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #10b981; font-family: monospace;">${otpCode}</span>
      </div>
      <p style="font-size: 13px; color: #64748b; line-height: 1.5;">This verification code will expire in 10 minutes. If you did not make this request, you can safely ignore this email.</p>
      <hr style="border: none; border-top: 1px solid #1e293b; margin: 28px 0;" />
      <p style="font-size: 11px; color: #475569; margin: 0; text-align: center;">© Spendly Expenses. All rights reserved.</p>
    </div>
  `;

  const sender = getEffectiveSender();
  let messageId = null;

  try {
    // Attempt 1: Brevo SMTP Relay
    try {
      const transporter = getTransporter();
      const info = await transporter.sendMail({
        from: sender,
        to: normalizedEmail,
        subject,
        html
      });
      messageId = info.messageId;
      console.log(`[Spendly EmailService] Real Brevo SMTP delivery successful to ${normalizedEmail}! (Message ID: ${messageId})`);
    } catch (smtpErr) {
      console.warn(`[Spendly EmailService] Brevo SMTP attempt error: ${smtpErr.message}`);
      
      // Attempt 2: If BREVO_API_KEY is configured or SMTP_PASS is a Brevo API key, try Brevo REST API v3
      if (config.BREVO_API_KEY || (config.SMTP_PASS && config.SMTP_PASS.startsWith('xkeysib-'))) {
        console.log(`[Spendly EmailService] Falling back to Brevo REST API v3...`);
        const apiInfo = await sendViaBrevoApi({
          to: normalizedEmail,
          subject,
          html,
          text: `Your Spendly verification code is: ${otpCode}`
        });
        messageId = apiInfo.messageId;
        console.log(`[Spendly EmailService] Real Brevo REST API delivery successful to ${normalizedEmail}! (Message ID: ${messageId})`);
      } else {
        throw smtpErr;
      }
    }
  } catch (err) {
    console.error('[Spendly EmailService] Brevo real email delivery failed:', err.message);
    // Remove the OTP from DB since email could not be delivered
    db.prepare('DELETE FROM email_otps WHERE id = ?').run(id);

    let userMessage = "We couldn't deliver the verification code to your email.";
    if (err.message.includes('not configured')) {
      userMessage = "Brevo SMTP is not configured. Please set SMTP_USER and SMTP_PASS in .env.";
    } else if (err.message.includes('unverified sender') || err.message.includes('Sender address rejected')) {
      userMessage = "Email delivery error: The sender address is not verified in Brevo. Please check SMTP_FROM in .env.";
    } else if (err.message.includes('535') || err.message.includes('Authentication failed')) {
      userMessage = "Email delivery error: Brevo authentication failed. Please check SMTP_USER and SMTP_PASS in .env.";
    }
    throw new Error(userMessage);
  }

  return {
    success: true,
    message: 'A verification code has been sent to your email.'
  };
}

/**
 * Verify submitted OTP against hashed record in database
 */
function verifyOtp(email, otpCode, purpose) {
  const normalizedEmail = email.trim().toLowerCase();
  const trimmedOtp = (otpCode || '').trim();
  const now = Date.now();

  if (!trimmedOtp || trimmedOtp.length !== 6 || !/^\d{6}$/.test(trimmedOtp)) {
    return { success: false, error: 'Invalid verification code. Please enter 6 digits.' };
  }

  const record = db.prepare(`
    SELECT * FROM email_otps 
    WHERE email = ? AND purpose = ?
  `).get(normalizedEmail, purpose);

  if (!record) {
    return { success: false, error: 'No verification code found. Please request a new OTP.' };
  }

  if (now > record.expires_at) {
    db.prepare('DELETE FROM email_otps WHERE id = ?').run(record.id);
    return { success: false, error: 'This verification code has expired. Please request a new code.' };
  }

  if (record.attempts >= config.MAX_OTP_ATTEMPTS) {
    db.prepare('DELETE FROM email_otps WHERE id = ?').run(record.id);
    return { success: false, error: 'Too many verification attempts. Please request a new code.' };
  }

  const expectedHash = record.otp_code;
  const submittedHash = hashOtp(normalizedEmail, trimmedOtp);

  // Timing-safe comparison to prevent timing attacks
  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  const submittedBuffer = Buffer.from(submittedHash, 'hex');
  const isMatch = expectedBuffer.length === submittedBuffer.length && 
                  crypto.timingSafeEqual(expectedBuffer, submittedBuffer);

  if (!isMatch) {
    db.prepare(`
      UPDATE email_otps 
      SET attempts = attempts + 1 
      WHERE id = ?
    `).run(record.id);

    const remaining = config.MAX_OTP_ATTEMPTS - (record.attempts + 1);
    if (remaining <= 0) {
      db.prepare('DELETE FROM email_otps WHERE id = ?').run(record.id);
      return { 
        success: false, 
        error: 'Too many incorrect attempts. This code has been invalidated. Please request a new code.' 
      };
    }
    return { 
      success: false, 
      error: `Invalid verification code. ${remaining} attempt(s) remaining.` 
    };
  }

  // Verification successful! Clean up OTP record immediately (Single-use enforcement)
  db.prepare('DELETE FROM email_otps WHERE id = ?').run(record.id);

  return { success: true };
}

module.exports = {
  sendOtp,
  verifyOtp,
  getEffectiveSender,
  parseSender
};
