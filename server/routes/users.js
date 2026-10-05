const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');
const path = require('path');
const fs = require('fs');
const config = require('../config');

/**
 * GET /api/users/:id/profile
 * Retrieves sanitized public profile of another user
 * Protected by authentication: Only signed-in Spendly users can view member profiles
 */
router.get('/:id/profile', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Valid user ID is required.' });
    }

    // Parameterized lookup for public fields only
    const user = await db.prepare(
      'SELECT id, username, display_name, bio, avatar_url, created_at FROM users WHERE id = ?'
    ).get(id);

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Find shared groups between requesting user and target user
    const sharedGroups = await db.prepare(`
      SELECT g.id, g.name
      FROM groups g
      JOIN group_members gm1 ON g.id = gm1.group_id AND gm1.user_id = ?
      JOIN group_members gm2 ON g.id = gm2.group_id AND gm2.user_id = ?
      WHERE g.deleted_at IS NULL
      ORDER BY g.name ASC
    `).all(req.user.id, id);

    // Get total active group count for the user
    const groupCountRow = await db.prepare(`
      SELECT COUNT(DISTINCT gm.group_id) as count
      FROM group_members gm
      JOIN groups g ON gm.group_id = g.id
      WHERE gm.user_id = ? AND g.deleted_at IS NULL
    `).get(id);

    // Strictly sanitized public profile response
    res.json({
      profile: {
        id: user.id,
        username: user.username,
        displayName: user.display_name || user.username,
        bio: user.bio || '',
        avatarUrl: user.avatar_url || '',
        createdAt: Number(user.created_at),
        sharedGroups: sharedGroups.map(g => ({ id: g.id, name: g.name })),
        groupCount: Number(groupCountRow?.count || 0),
        isSelf: req.user.id === user.id
      }
    });
  } catch (err) {
    console.error('[Public Profile Error]', err);
    res.status(500).json({ error: 'Failed to retrieve user profile.' });
  }
});

/**
 * GET /api/users/:id/avatar
 * Serves avatar image for a specific user ID directly
 */
router.get('/:id/avatar', async (req, res) => {
  try {
    const { id } = req.params;

    const row = await db.prepare(
      'SELECT filename, mime_type, image_data FROM user_avatars WHERE user_id = ?'
    ).get(id);

    if (row && row.image_data) {
      const buffer = Buffer.from(row.image_data, 'base64');
      res.set('Content-Type', row.mime_type || 'image/jpeg');
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(buffer);
    }

    return res.status(404).json({ error: 'Avatar not found.' });
  } catch (err) {
    console.error('[User Avatar Error]', err);
    res.status(500).json({ error: 'Failed to load avatar.' });
  }
});

module.exports = router;
