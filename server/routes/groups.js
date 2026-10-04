const express = require('express');
const router = express.Router();
const groupService = require('../services/groupService');
const settlementService = require('../services/settlementService');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// 1. List user's groups
router.get('/', async (req, res) => {
  try {
    const groups = await groupService.getUserGroups(req.user.id);
    res.json({ groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Create group
router.post('/', async (req, res) => {
  try {
    const { name, invitedUsernames } = req.body;
    const groupDetails = await groupService.createGroup(req.user.id, { name, invitedUsernames });
    res.status(201).json(groupDetails);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 3. Get group details
router.get('/:id', async (req, res) => {
  try {
    const details = await groupService.getGroupDetails(req.params.id, req.user.id);
    res.json(details);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// 4. Invite member (Admin only, after billing / start)
router.post('/:id/invite', async (req, res) => {
  try {
    const { username } = req.body;
    const result = await groupService.sendInvitation(req.params.id, req.user.id, username);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 5. Respond to invitation
router.post('/invitations/:invitationId/respond', async (req, res) => {
  try {
    const { accept } = req.body;
    const result = await groupService.respondToInvitation(req.user.id, req.params.invitationId, !!accept);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 6. Set temporary name for member (Admin only)
router.put('/:id/members/:userId/temporary-name', async (req, res) => {
  try {
    const { temporaryName } = req.body;
    const result = await groupService.setMemberTemporaryName(req.user.id, req.params.id, req.params.userId, temporaryName);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 7. Remove member (Admin only, after billing)
router.delete('/:id/members/:userId', async (req, res) => {
  try {
    const result = await groupService.removeMember(req.user.id, req.params.id, req.params.userId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 8. Member request to leave group
router.post('/:id/leave-request', async (req, res) => {
  try {
    const result = await groupService.requestLeaveGroup(req.user.id, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 9. Admin approves leave request (after billing)
router.post('/:id/members/:userId/approve-leave', async (req, res) => {
  try {
    const result = await groupService.approveLeaveRequest(req.user.id, req.params.id, req.params.userId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 10. Admin rejects leave request (Part 10)
router.post('/:id/members/:userId/reject-leave', async (req, res) => {
  try {
    const result = await groupService.rejectLeaveRequest(req.user.id, req.params.id, req.params.userId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 11. Remove group from user's account after billing (Part 5)
router.post('/:id/remove-from-account', async (req, res) => {
  try {
    const result = await groupService.removeGroupFromAccount(req.user.id, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 12. Delete group (Admin only, after billing)
router.delete('/:id', async (req, res) => {
  try {
    const result = await groupService.deleteGroup(req.user.id, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 11. Add group expense
router.post('/:id/expenses', async (req, res) => {
  try {
    const { description, amount, idempotencyKey } = req.body;
    const expense = await groupService.addGroupExpense(req.user.id, req.params.id, {
      description,
      amount,
      idempotencyKey
    });
    res.status(201).json({ expense });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 12. Edit group expense
router.put('/:id/expenses/:expId', async (req, res) => {
  try {
    const { description, amount } = req.body;
    const updated = await groupService.updateGroupExpense(req.user.id, req.params.id, req.params.expId, {
      description,
      amount
    });
    res.json({ expense: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 13. Delete group expense
router.delete('/:id/expenses/:expId', async (req, res) => {
  try {
    const result = await groupService.deleteGroupExpense(req.user.id, req.params.id, req.params.expId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 14. Generate group billing (Admin only, atomic)
router.post('/:id/billing', async (req, res) => {
  try {
    const result = await groupService.generateGroupBill(req.user.id, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 15. Start new group cycle (Admin only)
router.post('/:id/start-new-cycle', async (req, res) => {
  try {
    const result = await groupService.startNewGroupCycle(req.user.id, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 16. Mark settlement as paid (Payer only)
router.post('/settlements/:id/pay', async (req, res) => {
  try {
    const result = await settlementService.markSettlementPaid(req.user.id, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 17. Confirm settlement received (Receiver only)
router.post('/settlements/:id/confirm', async (req, res) => {
  try {
    const result = await settlementService.confirmSettlementReceived(req.user.id, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 18. Dispute settlement (Receiver only)
router.post('/settlements/:id/dispute', async (req, res) => {
  try {
    const { reason } = req.body;
    const result = await settlementService.disputeSettlement(req.user.id, req.params.id, reason);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
