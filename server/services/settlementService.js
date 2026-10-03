const crypto = require('crypto');
const db = require('../db/database');
const notificationService = require('./notificationService');
const websocketService = require('./websocketService');

/**
 * Deterministic settlement algorithm
 * @param {Array<{userId: string, username: string, displayName: string, spent: number}>} members 
 * @returns {{
 *   totalSpent: number,
 *   equalShare: number,
 *   balances: Array<{userId: string, username: string, displayName: string, spent: number, balance: number, share: number}>,
 *   settlements: Array<{payerId: string, receiverId: string, amount: number}>
 * }}
 */
function calculateSettlements(members) {
  if (!members || members.length === 0) {
    return { totalSpent: 0, equalShare: 0, balances: [], settlements: [] };
  }

  const n = members.length;
  const totalSpent = members.reduce((sum, m) => sum + m.spent, 0);

  // Equal share base quotient and remainder in paise
  const baseShare = Math.floor(totalSpent / n);
  const remainder = totalSpent % n;

  // Sort members by spent descending to assign single-paisa remainder deterministically to top spenders
  // (or if spent is equal, by userId alphabetically)
  const sortedForShare = [...members].sort((a, b) => {
    if (b.spent !== a.spent) return b.spent - a.spent;
    return a.userId.localeCompare(b.userId);
  });

  const memberShares = new Map();
  sortedForShare.forEach((m, idx) => {
    // First `remainder` members get (baseShare + 1) paise
    const share = idx < remainder ? baseShare + 1 : baseShare;
    memberShares.set(m.userId, share);
  });

  // Calculate exact balance for each member: balance = spent - share
  // sum(balances) is guaranteed to be exactly 0
  const balances = members.map(m => {
    const share = memberShares.get(m.userId);
    const balance = m.spent - share;
    return {
      userId: m.userId,
      username: m.username,
      displayName: m.displayName || m.username,
      spent: m.spent,
      share,
      balance
    };
  });

  // Separate debtors (balance < 0) and creditors (balance > 0)
  const debtors = [];
  const creditors = [];

  balances.forEach(b => {
    if (b.balance < 0) {
      debtors.push({ userId: b.userId, amount: -b.balance });
    } else if (b.balance > 0) {
      creditors.push({ userId: b.userId, amount: b.balance });
    }
  });

  // Sort deterministically to minimize transactions
  debtors.sort((a, b) => b.amount - a.amount || a.userId.localeCompare(b.userId));
  creditors.sort((a, b) => b.amount - a.amount || a.userId.localeCompare(b.userId));

  const settlements = [];
  let dIdx = 0;
  let cIdx = 0;

  while (dIdx < debtors.length && cIdx < creditors.length) {
    const debtor = debtors[dIdx];
    const creditor = creditors[cIdx];

    const transfer = Math.min(debtor.amount, creditor.amount);
    if (transfer > 0) {
      settlements.push({
        payerId: debtor.userId,
        receiverId: creditor.userId,
        amount: transfer
      });

      debtor.amount -= transfer;
      creditor.amount -= transfer;
    }

    if (debtor.amount === 0) dIdx++;
    if (creditor.amount === 0) cIdx++;
  }

  return {
    totalSpent,
    equalShare: baseShare,
    balances,
    settlements
  };
}

/**
 * Mark settlement as paid by the payer (Status -> 'pending_confirmation')
 */
async function markSettlementPaid(payerId, settlementId) {
  const settlement = await db.prepare(`
    SELECT s.*, g.name as group_name, u.username as payer_username, u.display_name as payer_name
    FROM settlements s
    JOIN groups g ON g.id = s.group_id
    JOIN users u ON u.id = s.payer_id
    WHERE s.id = ? AND s.payer_id = ?
  `).get(settlementId, payerId);

  if (!settlement) {
    throw new Error('Settlement not found or you are not the designated payer.');
  }

  if (settlement.status === 'completed') {
    throw new Error('This settlement is already completed and permanently locked.');
  }

  if (settlement.status === 'pending_confirmation') {
    return { success: true, message: 'Already marked as paid, waiting for receiver confirmation.' };
  }

  const now = Date.now();
  await db.prepare(`
    UPDATE settlements 
    SET status = 'pending_confirmation', paid_at = ? 
    WHERE id = ?
  `).run(now, settlementId);

  // Notify receiver to confirm receipt
  const formattedAmount = `₹${(settlement.amount / 100).toFixed(2)}`;
  const payerName = settlement.payer_name || settlement.payer_username;

  await notificationService.createNotification(settlement.receiver_id, {
    type: 'settlement_marked_paid',
    title: 'Payment Awaiting Confirmation',
    message: `${payerName} marked ${formattedAmount} as paid in group "${settlement.group_name}". Please confirm receipt.`,
    data: {
      settlementId,
      groupId: settlement.group_id,
      amount: settlement.amount,
      payerId: settlement.payer_id
    }
  });

  // Broadcast live update to group
  websocketService.broadcastToGroup(settlement.group_id, 'settlement_updated', {
    settlementId,
    status: 'pending_confirmation',
    paidAt: now
  });

  return { success: true, status: 'pending_confirmation' };
}

/**
 * Confirm settlement receipt by receiver (Status -> 'completed')
 * Locks settlement permanently
 */
async function confirmSettlementReceived(receiverId, settlementId) {
  const settlement = await db.prepare(`
    SELECT s.*, g.name as group_name, u.username as receiver_username, u.display_name as receiver_name
    FROM settlements s
    JOIN groups g ON g.id = s.group_id
    JOIN users u ON u.id = s.receiver_id
    WHERE s.id = ? AND s.receiver_id = ?
  `).get(settlementId, receiverId);

  if (!settlement) {
    throw new Error('Settlement not found or you are not the designated receiver.');
  }

  if (settlement.status === 'completed') {
    return { success: true, message: 'Settlement already completed.' };
  }

  if (settlement.status === 'pending') {
    throw new Error('Payer has not marked this settlement as paid yet.');
  }

  const now = Date.now();
  await db.prepare(`
    UPDATE settlements 
    SET status = 'completed', confirmed_at = ? 
    WHERE id = ?
  `).run(now, settlementId);

  // Notify payer that payment was confirmed
  const formattedAmount = `₹${(settlement.amount / 100).toFixed(2)}`;
  const receiverName = settlement.receiver_name || settlement.receiver_username;

  await notificationService.createNotification(settlement.payer_id, {
    type: 'settlement_confirmed',
    title: 'Payment Confirmed',
    message: `${receiverName} confirmed receiving ${formattedAmount} in group "${settlement.group_name}". Settlement completed!`,
    data: {
      settlementId,
      groupId: settlement.group_id,
      amount: settlement.amount
    }
  });

  // Broadcast live update to group
  websocketService.broadcastToGroup(settlement.group_id, 'settlement_updated', {
    settlementId,
    status: 'completed',
    confirmedAt: now
  });

  return { success: true, status: 'completed' };
}

/**
 * Dispute / Reject settlement by receiver (Reverts status to 'pending')
 */
async function disputeSettlement(receiverId, settlementId, reason = '') {
  const settlement = await db.prepare(`
    SELECT s.*, g.name as group_name, u.username as receiver_username, u.display_name as receiver_name
    FROM settlements s
    JOIN groups g ON g.id = s.group_id
    JOIN users u ON u.id = s.receiver_id
    WHERE s.id = ? AND s.receiver_id = ?
  `).get(settlementId, receiverId);

  if (!settlement) {
    throw new Error('Settlement not found or you are not the designated receiver.');
  }

  if (settlement.status === 'completed') {
    throw new Error('Completed settlements cannot be disputed.');
  }

  await db.prepare(`
    UPDATE settlements 
    SET status = 'pending', paid_at = NULL 
    WHERE id = ?
  `).run(settlementId);

  const formattedAmount = `₹${(settlement.amount / 100).toFixed(2)}`;
  const receiverName = settlement.receiver_name || settlement.receiver_username;

  await notificationService.createNotification(settlement.payer_id, {
    type: 'settlement_disputed',
    title: 'Payment Not Received',
    message: `${receiverName} indicated they have not received ${formattedAmount} in group "${settlement.group_name}". Status reverted to pending.`,
    data: {
      settlementId,
      groupId: settlement.group_id
    }
  });

  websocketService.broadcastToGroup(settlement.group_id, 'settlement_updated', {
    settlementId,
    status: 'pending',
    paidAt: null
  });

  return { success: true, status: 'pending' };
}

module.exports = {
  calculateSettlements,
  markSettlementPaid,
  confirmSettlementReceived,
  disputeSettlement
};
