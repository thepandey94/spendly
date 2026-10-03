const crypto = require('crypto');
const db = require('../db/database');
const config = require('../config');
const notificationService = require('./notificationService');
const websocketService = require('./websocketService');
const settlementService = require('./settlementService');
const { toPaise } = require('./personalService');

/**
 * Helper to check if a user is an active member or admin of a group
 */
async function getMemberRole(groupId, userId) {
  const member = await db.prepare(`
    SELECT gm.*, g.name as group_name, g.admin_id, g.deleted_at
    FROM group_members gm
    JOIN groups g ON g.id = gm.group_id
    WHERE gm.group_id = ? AND gm.user_id = ? AND gm.status = 'active' AND g.deleted_at IS NULL
  `).get(groupId, userId);

  return member;
}

/**
 * Get active group cycle or null
 */
async function getActiveGroupCycle(groupId) {
  return await db.prepare(`
    SELECT * FROM group_cycles 
    WHERE group_id = ? AND status = 'active'
    ORDER BY cycle_number DESC 
    LIMIT 1
  `).get(groupId);
}

/**
 * Get the latest cycle of a group regardless of status
 */
async function getLatestGroupCycle(groupId) {
  return await db.prepare(`
    SELECT * FROM group_cycles 
    WHERE group_id = ? 
    ORDER BY cycle_number DESC 
    LIMIT 1
  `).get(groupId);
}

/**
 * Check if group cycle allows membership modification
 * Membership changes (add, remove, leave approve) are prohibited during an active cycle (Section 43)
 */
async function assertMembershipChangesAllowed(groupId) {
  const activeCycle = await getActiveGroupCycle(groupId);
  if (activeCycle) {
    // Check if there are expenses in the active cycle
    const countRow = await db.prepare('SELECT COUNT(*) as count FROM group_expenses WHERE cycle_id = ?').get(activeCycle.id);
    const count = countRow ? countRow.count : 0;
    if (count > 0) {
      throw new Error('Complete billing before changing group membership.');
    }
  }
}

/**
 * Create a new group
 * Group creator becomes Admin
 */
async function createGroup(creatorId, { name, invitedUsernames = [] }) {
  if (!name || !name.trim()) {
    throw new Error('Group name is required.');
  }

  const groupId = crypto.randomUUID();
  const now = Date.now();
  const cleanName = name.trim();

  await db.transaction(async () => {
    // 1. Create group
    await db.prepare(`
      INSERT INTO groups (id, name, admin_id, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, NULL)
    `).run(groupId, cleanName, creatorId, now, now);

    // 2. Add creator as admin member (order_index = 0)
    const memberId = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO group_members (id, group_id, user_id, role, temporary_name, order_index, joined_at, status)
      VALUES (?, ?, ?, 'admin', NULL, 0, ?, 'active')
    `).run(memberId, groupId, creatorId, now);

    // 3. Create initial group cycle #1
    const cycleId = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO group_cycles (id, group_id, cycle_number, status, created_at)
      VALUES (?, ?, 1, 'active', ?)
    `).run(cycleId, groupId, now);
  });

  // Send invitations to requested usernames
  const invitedResults = [];
  if (Array.isArray(invitedUsernames)) {
    for (const uname of invitedUsernames) {
      if (uname) {
        try {
          const invite = await sendInvitation(groupId, creatorId, uname);
          invitedResults.push(invite);
        } catch (err) {
          console.warn(`[Spendly Group] Could not invite ${uname}:`, err.message);
        }
      }
    }
  }

  return await getGroupDetails(groupId, creatorId);
}

/**
 * Send an invitation to join a group
 */
async function sendInvitation(groupId, inviterId, inviteeUsername) {
  const member = await getMemberRole(groupId, inviterId);
  if (!member) {
    throw new Error('You are not a member of this group.');
  }
  if (member.role !== 'admin') {
    throw new Error('Only the group admin can invite new members.');
  }

  // Check membership change restrictions (Section 43)
  await assertMembershipChangesAllowed(groupId);

  // Check 50-member limit (Section 25)
  const countRow = await db.prepare(`
    SELECT COUNT(*) as count FROM group_members WHERE group_id = ? AND status = 'active'
  `).get(groupId);
  const currentMembersCount = countRow ? countRow.count : 0;

  if (currentMembersCount >= config.MAX_GROUP_MEMBERS) {
    throw new Error(`Group has reached the maximum capacity of ${config.MAX_GROUP_MEMBERS} members.`);
  }

  const cleanUsername = inviteeUsername.trim().toLowerCase();
  const invitee = await db.prepare('SELECT id, username, display_name FROM users WHERE username = ? COLLATE NOCASE').get(cleanUsername);
  if (!invitee) {
    throw new Error(`No user found with username "${inviteeUsername}".`);
  }

  if (invitee.id === inviterId) {
    throw new Error('You cannot invite yourself.');
  }

  // Check if user is already an active member
  const alreadyMember = await db.prepare(`
    SELECT id FROM group_members WHERE group_id = ? AND user_id = ? AND status = 'active'
  `).get(groupId, invitee.id);
  if (alreadyMember) {
    throw new Error(`${invitee.username} is already an active member of this group.`);
  }

  // Check if invitation is already pending
  const existingInvite = await db.prepare(`
    SELECT id FROM group_invitations 
    WHERE group_id = ? AND invitee_id = ? AND status = 'pending'
  `).get(groupId, invitee.id);
  if (existingInvite) {
    throw new Error(`An invitation has already been sent to ${invitee.username}.`);
  }

  const invitationId = crypto.randomUUID();
  const now = Date.now();

  await db.prepare(`
    INSERT INTO group_invitations (id, group_id, inviter_id, invitee_id, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(invitationId, groupId, inviterId, invitee.id, now);

  const group = await db.prepare('SELECT name FROM groups WHERE id = ?').get(groupId);
  const inviter = await db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(inviterId);

  // Send real-time in-app notification & web push to invitee
  await notificationService.createNotification(invitee.id, {
    type: 'group_invitation',
    title: 'Group Invitation',
    message: `${inviter.display_name || inviter.username} invited you to join "${group.name}".`,
    data: {
      invitationId,
      groupId,
      groupName: group.name,
      inviterName: inviter.display_name || inviter.username
    }
  });

  return {
    success: true,
    invitationId,
    invitee: {
      id: invitee.id,
      username: invitee.username,
      displayName: invitee.display_name
    }
  };
}

/**
 * Accept or decline a group invitation
 */
async function respondToInvitation(inviteeId, invitationId, accept) {
  const invite = await db.prepare(`
    SELECT gi.*, g.name as group_name, g.admin_id, u.username as inviter_username
    FROM group_invitations gi
    JOIN groups g ON g.id = gi.group_id
    JOIN users u ON u.id = gi.inviter_id
    WHERE gi.id = ? AND gi.invitee_id = ? AND gi.status = 'pending'
  `).get(invitationId, inviteeId);

  if (!invite) {
    throw new Error('Invitation not found or has already been responded to.');
  }

  const now = Date.now();

  if (!accept) {
    await db.prepare(`
      UPDATE group_invitations 
      SET status = 'declined', responded_at = ? 
      WHERE id = ?
    `).run(now, invitationId);

    const responder = await db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(inviteeId);
    await notificationService.createNotification(invite.inviter_id, {
      type: 'invitation_declined',
      title: 'Invitation Declined',
      message: `${responder.display_name || responder.username} declined your invitation to join "${invite.group_name}".`,
      data: { groupId: invite.group_id }
    });

    return { success: true, status: 'declined' };
  }

  // If accepting, check capacity again
  const countRow = await db.prepare(`
    SELECT COUNT(*) as count FROM group_members WHERE group_id = ? AND status = 'active'
  `).get(invite.group_id);
  const currentMembersCount = countRow ? countRow.count : 0;

  if (currentMembersCount >= config.MAX_GROUP_MEMBERS) {
    throw new Error('This group is currently at full capacity (50 members).');
  }

  // Get max order_index to preserve member-addition ordering for admin succession
  const maxRow = await db.prepare(`
    SELECT COALESCE(MAX(order_index), 0) as max_order FROM group_members WHERE group_id = ?
  `).get(invite.group_id);
  const maxOrder = maxRow ? maxRow.max_order : 0;

  await db.transaction(async () => {
    // Update invitation status
    await db.prepare(`
      UPDATE group_invitations 
      SET status = 'accepted', responded_at = ? 
      WHERE id = ?
    `).run(now, invitationId);

    // Check if member was previously in group
    const prevMember = await db.prepare('SELECT id FROM group_members WHERE group_id = ? AND user_id = ?').get(invite.group_id, inviteeId);
    if (prevMember) {
      await db.prepare(`
        UPDATE group_members 
        SET status = 'active', role = 'member', order_index = ?, joined_at = ?
        WHERE id = ?
      `).run(maxOrder + 1, now, prevMember.id);
    } else {
      const memberId = crypto.randomUUID();
      await db.prepare(`
        INSERT INTO group_members (id, group_id, user_id, role, temporary_name, order_index, joined_at, status)
        VALUES (?, ?, ?, 'member', NULL, ?, ?, 'active')
      `).run(memberId, invite.group_id, inviteeId, maxOrder + 1, now);
    }
  });

  const responder = await db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(inviteeId);

  // Notify admin that user joined
  await notificationService.createNotification(invite.admin_id, {
    type: 'invitation_accepted',
    title: 'New Member Joined',
    message: `${responder.display_name || responder.username} joined "${invite.group_name}".`,
    data: { groupId: invite.group_id, userId: inviteeId }
  });

  // Broadcast to group in real-time
  websocketService.broadcastToGroup(invite.group_id, 'member_joined', {
    groupId: invite.group_id,
    user: {
      id: inviteeId,
      username: responder.username,
      displayName: responder.display_name
    }
  });

  return { success: true, status: 'accepted', groupId: invite.group_id };
}

/**
 * Assign temporary name to a group member (Admin only, Section 28)
 */
async function setMemberTemporaryName(adminId, groupId, targetUserId, temporaryName) {
  const adminMember = await getMemberRole(groupId, adminId);
  if (!adminMember || adminMember.role !== 'admin') {
    throw new Error('Only the group admin can assign temporary names.');
  }

  const cleanTempName = temporaryName && temporaryName.trim() ? temporaryName.trim() : null;

  await db.prepare(`
    UPDATE group_members 
    SET temporary_name = ? 
    WHERE group_id = ? AND user_id = ?
  `).run(cleanTempName, groupId, targetUserId);

  websocketService.broadcastToGroup(groupId, 'member_updated', {
    userId: targetUserId,
    temporaryName: cleanTempName
  });

  return { success: true, temporaryName: cleanTempName };
}

/**
 * Remove a member from the group (Admin only, Section 44)
 */
async function removeMember(adminId, groupId, targetUserId) {
  const adminMember = await getMemberRole(groupId, adminId);
  if (!adminMember || adminMember.role !== 'admin') {
    throw new Error('Only the group admin can remove members.');
  }

  if (adminId === targetUserId) {
    throw new Error('Admin cannot remove themselves using this option. Use leave group.');
  }

  await assertMembershipChangesAllowed(groupId);

  const targetMember = await getMemberRole(groupId, targetUserId);
  if (!targetMember) {
    throw new Error('Target user is not an active member of this group.');
  }

  const now = Date.now();
  await db.prepare(`
    UPDATE group_members 
    SET status = 'removed' 
    WHERE group_id = ? AND user_id = ?
  `).run(groupId, targetUserId);

  const group = await db.prepare('SELECT name FROM groups WHERE id = ?').get(groupId);

  await notificationService.createNotification(targetUserId, {
    type: 'member_removed',
    title: 'Removed from Group',
    message: `You were removed from "${group.name}" by the admin.`,
    data: { groupId }
  });

  websocketService.broadcastToGroup(groupId, 'member_removed', {
    groupId,
    userId: targetUserId
  });

  return { success: true };
}

/**
 * Non-admin requests to leave the group (Section 45)
 */
async function requestLeaveGroup(userId, groupId) {
  const member = await getMemberRole(groupId, userId);
  if (!member) {
    throw new Error('You are not an active member of this group.');
  }
  if (member.role === 'admin') {
    throw new Error('Admin must handle succession before leaving.');
  }

  await assertMembershipChangesAllowed(groupId);

  const now = Date.now();
  await db.prepare(`
    UPDATE group_members 
    SET leave_requested_at = ? 
    WHERE group_id = ? AND user_id = ?
  `).run(now, groupId, userId);

  const user = await db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(userId);
  const group = await db.prepare('SELECT admin_id, name FROM groups WHERE id = ?').get(groupId);

  await notificationService.createNotification(group.admin_id, {
    type: 'leave_request',
    title: 'Leave Request Received',
    message: `${user.display_name || user.username} has requested to leave "${group.name}".`,
    data: { groupId, userId }
  });

  return { success: true, message: 'Leave request submitted to admin for approval.' };
}

/**
 * Admin approves a member's leave request (Section 46)
 */
async function approveLeaveRequest(adminId, groupId, targetUserId) {
  const adminMember = await getMemberRole(groupId, adminId);
  if (!adminMember || adminMember.role !== 'admin') {
    throw new Error('Only the group admin can approve leave requests.');
  }

  await assertMembershipChangesAllowed(groupId);

  await db.prepare(`
    UPDATE group_members 
    SET status = 'left', leave_requested_at = NULL 
    WHERE group_id = ? AND user_id = ?
  `).run(groupId, targetUserId);

  const group = await db.prepare('SELECT name FROM groups WHERE id = ?').get(groupId);

  await notificationService.createNotification(targetUserId, {
    type: 'leave_approved',
    title: 'Leave Request Approved',
    message: `Your request to leave "${group.name}" was approved.`,
    data: { groupId }
  });

  websocketService.broadcastToGroup(groupId, 'member_left', {
    groupId,
    userId: targetUserId
  });

  return { success: true };
}

/**
 * Handle Admin Leaving: Apply Admin Succession Rule (Section 47)
 * The first member originally added by that admin becomes the new admin.
 */
async function handleAdminLeave(adminId, groupId) {
  await assertMembershipChangesAllowed(groupId);

  // Find the first member originally added by that admin (lowest order_index)
  const successor = await db.prepare(`
    SELECT user_id FROM group_members 
    WHERE group_id = ? AND user_id != ? AND status = 'active' 
    ORDER BY order_index ASC 
    LIMIT 1
  `).get(groupId, adminId);

  const group = await db.prepare('SELECT name FROM groups WHERE id = ?').get(groupId);
  const now = Date.now();

  if (successor) {
    await db.transaction(async () => {
      // 1. Promote successor to admin
      await db.prepare('UPDATE groups SET admin_id = ?, updated_at = ? WHERE id = ?').run(successor.user_id, now, groupId);
      await db.prepare("UPDATE group_members SET role = 'admin' WHERE group_id = ? AND user_id = ?").run(groupId, successor.user_id);
      // 2. Mark old admin as left
      await db.prepare("UPDATE group_members SET status = 'left' WHERE group_id = ? AND user_id = ?").run(groupId, adminId);
    });

    await notificationService.createNotification(successor.user_id, {
      type: 'admin_promoted',
      title: 'Promoted to Group Admin',
      message: `You are now the admin of "${group.name}" following the previous admin's departure.`,
      data: { groupId }
    });

    websocketService.broadcastToGroup(groupId, 'admin_changed', {
      groupId,
      newAdminId: successor.user_id,
      oldAdminId: adminId
    });

    return { success: true, newAdminId: successor.user_id };
  } else {
    // No other members; mark group as deleted
    await db.prepare('UPDATE groups SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, groupId);
    await db.prepare("UPDATE group_members SET status = 'left' WHERE group_id = ? AND user_id = ?").run(groupId, adminId);

    return { success: true, groupClosed: true };
  }
}

/**
 * Delete group (Admin only, ONLY AFTER BILLING, Section 48)
 */
async function deleteGroup(adminId, groupId) {
  const adminMember = await getMemberRole(groupId, adminId);
  if (!adminMember || adminMember.role !== 'admin') {
    throw new Error('Only the group admin can delete this group.');
  }

  await assertMembershipChangesAllowed(groupId);

  const now = Date.now();
  await db.prepare(`
    UPDATE groups 
    SET deleted_at = ?, updated_at = ? 
    WHERE id = ?
  `).run(now, now, groupId);

  websocketService.broadcastToGroup(groupId, 'group_deleted', { groupId });

  return { success: true, message: 'Group deleted successfully.' };
}

/**
 * Add Group Expense (Section 30)
 */
async function addGroupExpense(userId, groupId, { description, amount, idempotencyKey = null }) {
  const member = await getMemberRole(groupId, userId);
  if (!member) {
    throw new Error('You are not an active member of this group.');
  }

  const activeCycle = await getActiveGroupCycle(groupId);
  if (!activeCycle) {
    throw new Error('This cycle is already billed. Admin must start a new cycle to add expenses.');
  }

  if (!description || !description.trim()) {
    throw new Error('Description is required.');
  }

  const amountPaise = toPaise(amount);
  if (amountPaise <= 0) {
    throw new Error('Amount must be greater than zero.');
  }

  // Idempotency check
  if (idempotencyKey) {
    const existing = await db.prepare('SELECT * FROM group_expenses WHERE idempotency_key = ?').get(idempotencyKey);
    if (existing) return existing;
  }

  const id = crypto.randomUUID();
  const now = Date.now();

  await db.prepare(`
    INSERT INTO group_expenses (id, group_id, cycle_id, user_id, description, amount, idempotency_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, groupId, activeCycle.id, userId, description.trim(), amountPaise, idempotencyKey, now);

  const expense = await db.prepare(`
    SELECT ge.*, u.username, u.display_name, gm.temporary_name
    FROM group_expenses ge
    JOIN users u ON u.id = ge.user_id
    JOIN group_members gm ON gm.group_id = ge.group_id AND gm.user_id = ge.user_id
    WHERE ge.id = ?
  `).get(id);

  // Broadcast to all members of the group in real-time
  websocketService.broadcastToGroup(groupId, 'expense_added', {
    groupId,
    expense
  });

  return expense;
}

/**
 * Edit Group Expense (Only own expense, active cycle, Section 31)
 */
async function updateGroupExpense(userId, groupId, expenseId, { description, amount }) {
  const member = await getMemberRole(groupId, userId);
  if (!member) throw new Error('Not an active member.');

  const expense = await db.prepare(`
    SELECT ge.*, gc.status as cycle_status
    FROM group_expenses ge
    JOIN group_cycles gc ON gc.id = ge.cycle_id
    WHERE ge.id = ? AND ge.group_id = ?
  `).get(expenseId, groupId);

  if (!expense) throw new Error('Expense entry not found.');

  if (expense.user_id !== userId) {
    throw new Error('You can only edit your own expenses.');
  }

  if (expense.cycle_status !== 'active') {
    throw new Error('Cannot edit an expense from a billed cycle.');
  }

  const updates = [];
  const params = [];

  if (description && description.trim()) {
    updates.push('description = ?');
    params.push(description.trim());
  }

  if (amount !== undefined && amount !== null) {
    const amountPaise = toPaise(amount);
    if (amountPaise <= 0) throw new Error('Amount must be greater than zero.');
    updates.push('amount = ?');
    params.push(amountPaise);
  }

  if (updates.length > 0) {
    params.push(expenseId);
    await db.prepare(`UPDATE group_expenses SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  const updated = await db.prepare(`
    SELECT ge.*, u.username, u.display_name, gm.temporary_name
    FROM group_expenses ge
    JOIN users u ON u.id = ge.user_id
    JOIN group_members gm ON gm.group_id = ge.group_id AND gm.user_id = ge.user_id
    WHERE ge.id = ?
  `).get(expenseId);

  websocketService.broadcastToGroup(groupId, 'expense_updated', {
    groupId,
    expense: updated
  });

  return updated;
}

/**
 * Delete Group Expense (Only own expense, active cycle, Section 31)
 */
async function deleteGroupExpense(userId, groupId, expenseId) {
  const member = await getMemberRole(groupId, userId);
  if (!member) throw new Error('Not an active member.');

  const expense = await db.prepare(`
    SELECT ge.*, gc.status as cycle_status
    FROM group_expenses ge
    JOIN group_cycles gc ON gc.id = ge.cycle_id
    WHERE ge.id = ? AND ge.group_id = ?
  `).get(expenseId, groupId);

  if (!expense) throw new Error('Expense entry not found.');

  if (expense.user_id !== userId) {
    throw new Error('You can only delete your own expenses.');
  }

  if (expense.cycle_status !== 'active') {
    throw new Error('Cannot delete an expense from a billed cycle.');
  }

  await db.prepare('DELETE FROM group_expenses WHERE id = ?').run(expenseId);

  websocketService.broadcastToGroup(groupId, 'expense_deleted', {
    groupId,
    expenseId
  });

  return { success: true };
}

/**
 * Group Billing: Atomic generation of group bill & settlements (Sections 34 - 41)
 * Admin only, locked atomically, exactly one bill per cycle
 */
async function generateGroupBill(adminId, groupId) {
  const adminMember = await getMemberRole(groupId, adminId);
  if (!adminMember || adminMember.role !== 'admin') {
    throw new Error('Only the group admin can generate billing for this group.');
  }

  const activeCycle = await getActiveGroupCycle(groupId);
  if (!activeCycle) {
    throw new Error('No active cycle found to bill.');
  }

  // Check if bill already exists (idempotency guard)
  const existingBill = await db.prepare('SELECT * FROM group_bills WHERE cycle_id = ?').get(activeCycle.id);
  if (existingBill) {
    return {
      bill: existingBill,
      snapshot: JSON.parse(existingBill.bill_snapshot_json)
    };
  }

  const group = await db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);

  // Get all active members for this cycle with frozen snapshot attributes
  const members = await db.prepare(`
    SELECT gm.user_id, gm.role, gm.temporary_name, gm.order_index,
           u.username, u.display_name, u.avatar_url
    FROM group_members gm
    JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = ? AND gm.status = 'active'
    ORDER BY gm.order_index ASC
  `).all(groupId);

  if (members.length === 0) {
    throw new Error('Group has no active members.');
  }

  // Get all expenses in this cycle
  const expenses = await db.prepare(`
    SELECT * FROM group_expenses 
    WHERE cycle_id = ? 
    ORDER BY created_at ASC
  `).all(activeCycle.id);

  // Group expenses by member
  const spentByMember = new Map();
  members.forEach(m => spentByMember.set(m.user_id, 0));
  expenses.forEach(e => {
    spentByMember.set(e.user_id, (spentByMember.get(e.user_id) || 0) + e.amount);
  });

  // Prepare input for settlement algorithm
  const settlementMembersInput = members.map(m => ({
    userId: m.user_id,
    username: m.username,
    displayName: m.temporary_name || m.display_name || m.username,
    spent: spentByMember.get(m.user_id) || 0
  }));

  // Run deterministic settlement calculation
  const settlementCalc = settlementService.calculateSettlements(settlementMembersInput);

  const now = Date.now();
  const billId = crypto.randomUUID();

  // Prepare immutable snapshot
  const snapshot = {
    billId,
    groupId,
    groupName: group.name,
    cycleId: activeCycle.id,
    cycleNumber: activeCycle.cycle_number,
    billedAt: now,
    memberCount: members.length,
    totalSpent: settlementCalc.totalSpent,
    equalShare: settlementCalc.equalShare,
    members: members.map(m => ({
      userId: m.user_id,
      role: m.role,
      username: m.username,
      displayName: m.display_name,
      temporaryName: m.temporary_name,
      avatarUrl: m.avatar_url,
      spent: spentByMember.get(m.user_id) || 0,
      share: settlementCalc.balances.find(b => b.userId === m.user_id)?.share || 0,
      balance: settlementCalc.balances.find(b => b.userId === m.user_id)?.balance || 0
    })),
    settlements: settlementCalc.settlements,
    expenseCount: expenses.length
  };

  const snapshotJson = JSON.stringify(snapshot);

  // Atomic transaction: lock cycle, save bill, insert individual settlements
  await db.transaction(async () => {
    // 1. Lock cycle
    await db.prepare(`
      UPDATE group_cycles 
      SET status = 'billed', billed_at = ? 
      WHERE id = ? AND status = 'active'
    `).run(now, activeCycle.id);

    // 2. Insert group bill
    await db.prepare(`
      INSERT INTO group_bills (
        id, group_id, cycle_id, cycle_number, group_name,
        total_spent, member_count, equal_share, bill_snapshot_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      billId, groupId, activeCycle.id, activeCycle.cycle_number, group.name,
      settlementCalc.totalSpent, members.length, settlementCalc.equalShare, snapshotJson, now
    );

    // 3. Insert individual settlement records with status 'pending'
    for (const s of settlementCalc.settlements) {
      const sId = crypto.randomUUID();
      await db.prepare(`
        INSERT INTO settlements (id, bill_id, group_id, payer_id, receiver_id, amount, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(sId, billId, groupId, s.payerId, s.receiverId, s.amount, now);
    }
  });

  // Notify members that billing was generated
  for (const m of members) {
    await notificationService.createNotification(m.user_id, {
      type: 'group_billed',
      title: 'Group Cycle Billed',
      message: `Billing generated for cycle #${activeCycle.cycle_number} of "${group.name}". Check your settlements.`,
      data: { groupId, billId, cycleNumber: activeCycle.cycle_number }
    });
  }

  // Broadcast billing event to group in real-time
  websocketService.broadcastToGroup(groupId, 'group_billed', {
    groupId,
    billId,
    cycleNumber: activeCycle.cycle_number
  });

  const savedBill = await db.prepare('SELECT * FROM group_bills WHERE id = ?').get(billId);

  return {
    bill: savedBill,
    snapshot
  };
}

/**
 * Start a New Group Cycle (Admin only, Section 42)
 */
async function startNewGroupCycle(adminId, groupId) {
  const adminMember = await getMemberRole(groupId, adminId);
  if (!adminMember || adminMember.role !== 'admin') {
    throw new Error('Only the group admin can start a new billing cycle.');
  }

  const activeCycle = await getActiveGroupCycle(groupId);
  if (activeCycle) {
    throw new Error('An active cycle is already in progress. Complete billing before starting a new cycle.');
  }

  const lastCycle = await getLatestGroupCycle(groupId);
  const nextCycleNumber = lastCycle ? lastCycle.cycle_number + 1 : 1;
  const newCycleId = crypto.randomUUID();
  const now = Date.now();

  await db.prepare(`
    INSERT INTO group_cycles (id, group_id, cycle_number, status, created_at)
    VALUES (?, ?, ?, 'active', ?)
  `).run(newCycleId, groupId, nextCycleNumber, now);

  const group = await db.prepare('SELECT name FROM groups WHERE id = ?').get(groupId);

  // Notify members
  const members = await db.prepare(`SELECT user_id FROM group_members WHERE group_id = ? AND status = 'active'`).all(groupId);
  for (const m of members) {
    await notificationService.createNotification(m.user_id, {
      type: 'new_cycle_started',
      title: 'New Cycle Started',
      message: `A fresh billing cycle (#${nextCycleNumber}) has started for "${group.name}". You can now add new expenses.`,
      data: { groupId, cycleNumber: nextCycleNumber }
    });
  }

  websocketService.broadcastToGroup(groupId, 'new_cycle_started', {
    groupId,
    cycleNumber: nextCycleNumber
  });

  return await getGroupDetails(groupId, adminId);
}

/**
 * Get detailed group view for a member:
 * Active cycle expenses, live balances, members, settlements, and roles
 */
async function getGroupDetails(groupId, userId) {
  const member = await getMemberRole(groupId, userId);
  if (!member) {
    throw new Error('Group not found or you are not a member.');
  }

  const group = await db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
  const activeCycle = await getActiveGroupCycle(groupId);
  const latestCycle = await getLatestGroupCycle(groupId);

  // Get active members with profile info
  const members = await db.prepare(`
    SELECT gm.id as membership_id, gm.user_id, gm.role, gm.temporary_name, gm.order_index, gm.joined_at, gm.leave_requested_at,
           u.username, u.display_name, u.avatar_url
    FROM group_members gm
    JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = ? AND gm.status = 'active'
    ORDER BY gm.order_index ASC
  `).all(groupId);

  // Get expenses in the current cycle
  const currentCycleId = activeCycle ? activeCycle.id : (latestCycle ? latestCycle.id : null);
  let expenses = [];
  if (currentCycleId) {
    expenses = await db.prepare(`
      SELECT ge.*, u.username, u.display_name, gm.temporary_name, u.avatar_url
      FROM group_expenses ge
      JOIN users u ON u.id = ge.user_id
      JOIN group_members gm ON gm.group_id = ge.group_id AND gm.user_id = ge.user_id
      WHERE ge.cycle_id = ?
      ORDER BY ge.created_at DESC
    `).all(currentCycleId);
  }

  // Calculate live totals and balances for current cycle
  const spentByMember = new Map();
  members.forEach(m => spentByMember.set(m.user_id, 0));
  expenses.forEach(e => {
    spentByMember.set(e.user_id, (spentByMember.get(e.user_id) || 0) + e.amount);
  });

  const settlementMembersInput = members.map(m => ({
    userId: m.user_id,
    username: m.username,
    displayName: m.temporary_name || m.display_name || m.username,
    spent: spentByMember.get(m.user_id) || 0
  }));

  const liveCalculations = settlementService.calculateSettlements(settlementMembersInput);

  // If latest cycle is billed, fetch latest bill and its settlements
  let latestBill = null;
  let activeSettlements = [];
  if (latestCycle && latestCycle.status === 'billed') {
    latestBill = await db.prepare('SELECT * FROM group_bills WHERE cycle_id = ?').get(latestCycle.id);
    if (latestBill) {
      activeSettlements = await db.prepare(`
        SELECT s.*, 
               pu.username as payer_username, pu.display_name as payer_name,
               ru.username as receiver_username, ru.display_name as receiver_name
        FROM settlements s
        JOIN users pu ON pu.id = s.payer_id
        JOIN users ru ON ru.id = s.receiver_id
        WHERE s.bill_id = ?
        ORDER BY s.created_at ASC
      `).all(latestBill.id);
    }
  }

  return {
    group: {
      id: group.id,
      name: group.name,
      adminId: group.admin_id,
      currentUserRole: member.role,
      currentUserTemporaryName: member.temporary_name
    },
    activeCycle,
    latestCycle,
    hasActiveCycle: !!activeCycle,
    members: members.map(m => ({
      userId: m.user_id,
      role: m.role,
      username: m.username,
      displayName: m.display_name,
      temporaryName: m.temporary_name,
      avatarUrl: m.avatar_url,
      joinedAt: m.joined_at,
      leaveRequested: !!m.leave_requested_at,
      spent: spentByMember.get(m.user_id) || 0,
      share: liveCalculations.balances.find(b => b.userId === m.user_id)?.share || 0,
      balance: liveCalculations.balances.find(b => b.userId === m.user_id)?.balance || 0
    })),
    expenses,
    liveTotals: {
      totalSpent: liveCalculations.totalSpent,
      equalShare: liveCalculations.equalShare,
      balances: liveCalculations.balances,
      suggestedSettlements: liveCalculations.settlements
    },
    latestBill,
    activeSettlements
  };
}

/**
 * List all groups for a user
 */
async function getUserGroups(userId) {
  const groups = await db.prepare(`
    SELECT g.id, g.name, g.admin_id, gm.role, gm.temporary_name, gm.joined_at,
           (SELECT COUNT(*) FROM group_members WHERE group_id = g.id AND status = 'active') as member_count,
           (SELECT status FROM group_cycles WHERE group_id = g.id ORDER BY cycle_number DESC LIMIT 1) as cycle_status,
           (SELECT cycle_number FROM group_cycles WHERE group_id = g.id ORDER BY cycle_number DESC LIMIT 1) as current_cycle_number
    FROM group_members gm
    JOIN groups g ON g.id = gm.group_id
    WHERE gm.user_id = ? AND gm.status = 'active' AND g.deleted_at IS NULL
    ORDER BY g.updated_at DESC
  `).all(userId);

  return groups;
}

module.exports = {
  createGroup,
  sendInvitation,
  respondToInvitation,
  setMemberTemporaryName,
  removeMember,
  requestLeaveGroup,
  approveLeaveRequest,
  deleteGroup,
  addGroupExpense,
  updateGroupExpense,
  deleteGroupExpense,
  generateGroupBill,
  startNewGroupCycle,
  getGroupDetails,
  getUserGroups,
  handleAdminLeave
};
