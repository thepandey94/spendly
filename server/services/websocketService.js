const { WebSocketServer, WebSocket } = require('ws');
const jwt = require('jsonwebtoken');
const config = require('../config');

let wss = null;
// Map of userId -> Set of WebSocket clients (allows multiple devices per user)
const userSockets = new Map();
// Map of groupId -> Set of userIds
const groupRooms = new Map();

function init(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.userId = null;
    ws.subscribedGroups = new Set();

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (messageRaw) => {
      try {
        const payload = JSON.parse(messageRaw);
        handleClientMessage(ws, payload);
      } catch (err) {
        console.error('[Spendly WS] Invalid message format:', err.message);
      }
    });

    ws.on('close', () => {
      cleanUpSocket(ws);
    });

    ws.on('error', (err) => {
      console.error('[Spendly WS] Socket error:', err.message);
      cleanUpSocket(ws);
    });
  });

  // Keep-alive heartbeat interval (every 30 seconds)
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        cleanUpSocket(ws);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  console.log('[Spendly WS] WebSocket real-time server initialized on /ws');
}

function handleClientMessage(ws, payload) {
  const { action, token, groupId } = payload;

  if (action === 'auth') {
    if (!token) return;
    try {
      const decoded = jwt.verify(token, config.JWT_SECRET);
      ws.userId = decoded.userId;

      if (!userSockets.has(ws.userId)) {
        userSockets.set(ws.userId, new Set());
      }
      userSockets.get(ws.userId).add(ws);

      ws.send(JSON.stringify({
        event: 'authenticated',
        data: { userId: ws.userId }
      }));
    } catch (err) {
      ws.send(JSON.stringify({ event: 'auth_error', message: 'Invalid token' }));
    }
  } else if (action === 'subscribe_group') {
    if (groupId) {
      ws.subscribedGroups.add(groupId);
      if (!groupRooms.has(groupId)) {
        groupRooms.set(groupId, new Set());
      }
      if (ws.userId) {
        groupRooms.get(groupId).add(ws.userId);
      }
      ws.send(JSON.stringify({ event: 'subscribed_group', data: { groupId } }));
    }
  } else if (action === 'unsubscribe_group') {
    if (groupId) {
      ws.subscribedGroups.delete(groupId);
      ws.send(JSON.stringify({ event: 'unsubscribed_group', data: { groupId } }));
    }
  }
}

function cleanUpSocket(ws) {
  if (ws.userId && userSockets.has(ws.userId)) {
    const set = userSockets.get(ws.userId);
    set.delete(ws);
    if (set.size === 0) {
      userSockets.delete(ws.userId);
    }
  }
}

/**
 * Broadcast event to a specific user across all their connected devices
 */
function broadcastToUser(userId, event, data) {
  if (!userSockets.has(userId)) return;
  const message = JSON.stringify({ event, data });
  const clients = userSockets.get(userId);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

/**
 * Broadcast event to all members subscribed to a group
 */
function broadcastToGroup(groupId, event, data, excludeUserId = null) {
  if (!wss) return;
  const message = JSON.stringify({ event, groupId, data });
  wss.clients.forEach((client) => {
    if (
      client.readyState === WebSocket.OPEN &&
      client.subscribedGroups &&
      client.subscribedGroups.has(groupId) &&
      (!excludeUserId || client.userId !== excludeUserId)
    ) {
      client.send(message);
    }
  });
}

/**
 * Broadcast event to all connected clients
 */
function broadcastToAll(event, data) {
  if (!wss) return;
  const message = JSON.stringify({ event, data });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function getStats() {
  return {
    status: wss ? 'operational' : 'inactive',
    clientCount: wss ? wss.clients.size : 0,
    userCount: userSockets.size
  };
}

module.exports = {
  init,
  broadcastToUser,
  broadcastToGroup,
  broadcastToAll,
  getStats
};
