const crypto = require('crypto');
const webPush = require('web-push');
const db = require('../db/database');
const config = require('../config');
const websocketService = require('./websocketService');

// Initialize Web Push if VAPID keys are provided
if (config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY) {
  try {
    webPush.setVapidDetails(
      config.VAPID_SUBJECT,
      config.VAPID_PUBLIC_KEY,
      config.VAPID_PRIVATE_KEY
    );
  } catch (err) {
    console.error('[Spendly Push] Failed to initialize webPush:', err.message);
  }
}

/**
 * Create and deliver a notification to a user
 */
async function createNotification(userId, { type, title, message, data = {} }) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const dataJson = JSON.stringify(data);

  // 1. Insert into database
  await db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, message, data_json, read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `).run(id, userId, type, title, message, dataJson, now);

  const notification = {
    id,
    user_id: userId,
    type,
    title,
    message,
    data,
    read: 0,
    created_at: now
  };

  // 2. Broadcast via WebSocket in real-time
  websocketService.broadcastToUser(userId, 'notification', notification);

  // 3. Send Web Push to all registered device subscriptions for this user
  if (config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY) {
    const subscriptions = await db.prepare(`
      SELECT * FROM push_subscriptions WHERE user_id = ?
    `).all(userId);

    const pushPayload = JSON.stringify({
      title,
      body: message,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge.png',
      data: {
        id,
        type,
        ...data
      }
    });

    for (const sub of subscriptions) {
      try {
        const keys = JSON.parse(sub.keys_json);
        const pushConfig = {
          endpoint: sub.endpoint,
          keys
        };
        await webPush.sendNotification(pushConfig, pushPayload);
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          // Subscription expired or gone, delete from database
          await db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
        } else {
          console.error('[Spendly Push] WebPush error:', err.message);
        }
      }
    }
  }

  return notification;
}

/**
 * Get user notifications with unread count
 */
async function getUserNotifications(userId, limit = 50) {
  const notifications = await db.prepare(`
    SELECT * FROM notifications 
    WHERE user_id = ? 
    ORDER BY created_at DESC 
    LIMIT ?
  `).all(userId, limit);

  const parsed = notifications.map(n => ({
    ...n,
    data: n.data_json ? JSON.parse(n.data_json) : {}
  }));

  const countRow = await db.prepare(`
    SELECT COUNT(*) as count FROM notifications 
    WHERE user_id = ? AND read = 0
  `).get(userId);
  const unreadCount = countRow ? Number(countRow.count) : 0;

  return { notifications: parsed, unreadCount };
}

/**
 * Mark a single notification or all user notifications as read
 */
async function markAsRead(userId, notificationId = null) {
  if (notificationId) {
    await db.prepare(`
      UPDATE notifications 
      SET read = 1 
      WHERE id = ? AND user_id = ?
    `).run(notificationId, userId);
  } else {
    await db.prepare(`
      UPDATE notifications 
      SET read = 1 
      WHERE user_id = ?
    `).run(userId);
  }
  return { success: true };
}

/**
 * Save or update web push subscription
 */
async function savePushSubscription(userId, subscription) {
  const { endpoint, keys } = subscription;
  if (!endpoint || !keys) {
    throw new Error('Invalid push subscription payload');
  }

  const existing = await db.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?').get(endpoint);
  const now = Date.now();
  const keysJson = JSON.stringify(keys);

  if (existing) {
    await db.prepare(`
      UPDATE push_subscriptions 
      SET user_id = ?, keys_json = ? 
      WHERE id = ?
    `).run(userId, keysJson, existing.id);
  } else {
    const id = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO push_subscriptions (id, user_id, endpoint, keys_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, userId, endpoint, keysJson, now);
  }

  return { success: true };
}

module.exports = {
  createNotification,
  getUserNotifications,
  markAsRead,
  savePushSubscription
};
