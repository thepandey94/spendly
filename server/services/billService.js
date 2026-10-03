const crypto = require('crypto');
const db = require('../db/database');

/**
 * Get all bills for a user (Personal bills and Group bills they participated in)
 */
function getUserBills(userId) {
  // 1. Personal bills (excluding those user chose to hide/delete from their view)
  const personalBills = db.prepare(`
    SELECT pb.*, 'personal' as bill_type
    FROM personal_bills pb
    WHERE pb.user_id = ? AND pb.hidden_by_user = 0
    ORDER BY pb.created_at DESC
  `).all(userId);

  // 2. Group bills where user was a member, excluding those hidden in user_hidden_bills
  const groupBills = db.prepare(`
    SELECT gb.*, 'group' as bill_type
    FROM group_bills gb
    JOIN group_members gm ON gm.group_id = gb.group_id AND gm.user_id = ?
    WHERE gb.id NOT IN (
      SELECT bill_id FROM user_hidden_bills WHERE user_id = ? AND bill_type = 'group'
    )
    ORDER BY gb.created_at DESC
  `).all(userId, userId);

  // Parse snapshots
  const parsedPersonal = personalBills.map(b => ({
    id: b.id,
    billType: 'personal',
    cycleNumber: b.cycle_number,
    totalSpent: b.total_spent,
    totalSetAmount: b.total_set_amount,
    totalRemaining: b.total_remaining,
    totalOverspent: b.total_overspent,
    entryCount: b.entry_count,
    createdAt: b.created_at,
    snapshot: JSON.parse(b.bill_snapshot_json)
  }));

  const parsedGroup = groupBills.map(b => {
    const snapshot = JSON.parse(b.bill_snapshot_json);
    const userMemberRecord = snapshot.members?.find(m => m.userId === userId);
    return {
      id: b.id,
      billType: 'group',
      groupId: b.group_id,
      groupName: b.group_name,
      cycleNumber: b.cycle_number,
      totalSpent: b.total_spent,
      memberCount: b.member_count,
      equalShare: b.equal_share,
      userSpent: userMemberRecord ? userMemberRecord.spent : 0,
      userShare: userMemberRecord ? userMemberRecord.share : 0,
      userBalance: userMemberRecord ? userMemberRecord.balance : 0,
      createdAt: b.created_at,
      snapshot
    };
  });

  return {
    personalBills: parsedPersonal,
    groupBills: parsedGroup
  };
}

/**
 * Get bill details by ID
 */
function getBillDetails(userId, billId, billType) {
  if (billType === 'personal') {
    const bill = db.prepare(`
      SELECT * FROM personal_bills WHERE id = ? AND user_id = ?
    `).get(billId, userId);

    if (!bill) throw new Error('Personal bill not found.');
    return {
      bill,
      billType: 'personal',
      snapshot: JSON.parse(bill.bill_snapshot_json)
    };
  } else if (billType === 'group') {
    const bill = db.prepare(`
      SELECT gb.* 
      FROM group_bills gb
      JOIN group_members gm ON gm.group_id = gb.group_id AND gm.user_id = ?
      WHERE gb.id = ?
    `).get(userId, billId);

    if (!bill) throw new Error('Group bill not found or access denied.');

    const settlements = db.prepare(`
      SELECT s.*, 
             pu.username as payer_username, pu.display_name as payer_name,
             ru.username as receiver_username, ru.display_name as receiver_name
      FROM settlements s
      JOIN users pu ON pu.id = s.payer_id
      JOIN users ru ON ru.id = s.receiver_id
      WHERE s.bill_id = ?
      ORDER BY s.created_at ASC
    `).all(billId);

    return {
      bill,
      billType: 'group',
      snapshot: JSON.parse(bill.bill_snapshot_json),
      settlements
    };
  } else {
    throw new Error('Invalid bill type.');
  }
}

/**
 * Delete a user's visible bill record (Section 49)
 * "Deleting a user's visible bill record must not corrupt shared historical records belonging to other users."
 */
function hideUserBill(userId, billId, billType) {
  if (billType === 'personal') {
    db.prepare(`
      UPDATE personal_bills 
      SET hidden_by_user = 1 
      WHERE id = ? AND user_id = ?
    `).run(billId, userId);
  } else if (billType === 'group') {
    const existing = db.prepare(`
      SELECT id FROM user_hidden_bills 
      WHERE user_id = ? AND bill_id = ? AND bill_type = 'group'
    `).get(userId, billId);

    if (!existing) {
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO user_hidden_bills (id, user_id, bill_id, bill_type, created_at)
        VALUES (?, ?, ?, 'group', ?)
      `).run(id, userId, billId, Date.now());
    }
  }

  return { success: true, message: 'Bill removed from your view.' };
}

module.exports = {
  getUserBills,
  getBillDetails,
  hideUserBill
};
