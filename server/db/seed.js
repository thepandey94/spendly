const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./database');
const personalService = require('../services/personalService');
const groupService = require('../services/groupService');
const settlementService = require('../services/settlementService');

async function seed() {
  console.log('🌱 Seeding Spendly development data...');
  await db.init();

  const passwordHash = bcrypt.hashSync('Password123!', 10);
  const now = Date.now();

  // Create Users
  const users = [
    { id: crypto.randomUUID(), email: 'rahul@spendly.app', username: 'rahul_dev', displayName: 'Rahul Sharma', bio: 'Software developer sharing Flat 402' },
    { id: crypto.randomUUID(), email: 'priya@spendly.app', username: 'priya_99', displayName: 'Priya Patel', bio: 'Hostel student & flatmate' },
    { id: crypto.randomUUID(), email: 'amit@spendly.app', username: 'amit_k', displayName: 'Amit Kumar', bio: 'College flatmate' },
    { id: crypto.randomUUID(), email: 'deepak@spendly.app', username: 'deepak_d', displayName: 'Deepak Verma', bio: 'Foodie & roommate' }
  ];

  for (const u of users) {
    const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(u.email);
    if (!existing) {
      await db.prepare(`
        INSERT INTO users (id, email, username, password_hash, display_name, bio, avatar_url, last_username_change, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, '', NULL, ?, ?)
      `).run(u.id, u.email, u.username, passwordHash, u.displayName, u.bio, now, now);

      // Create personal cycle #1
      const cycleId = crypto.randomUUID();
      await db.prepare(`
        INSERT INTO personal_cycles (id, user_id, cycle_number, status, created_at)
        VALUES (?, ?, 1, 'active', ?)
      `).run(cycleId, u.id, now);
    }
  }

  const rahul = await db.prepare('SELECT * FROM users WHERE email = ?').get('rahul@spendly.app');
  const priya = await db.prepare('SELECT * FROM users WHERE email = ?').get('priya@spendly.app');
  const amit = await db.prepare('SELECT * FROM users WHERE email = ?').get('amit@spendly.app');
  const deepak = await db.prepare('SELECT * FROM users WHERE email = ?').get('deepak@spendly.app');

  // Seed Personal Expense Heads for Rahul
  const activeCycle = await personalService.getActiveCycle(rahul.id);
  if (activeCycle) {
    const countRow = await db.prepare('SELECT COUNT(*) as count FROM personal_expense_heads WHERE cycle_id = ?').get(activeCycle.id);
    const headCount = countRow ? Number(countRow.count) : 0;
    if (headCount === 0) {
      const hRent = await personalService.createExpenseHead(rahul.id, { name: 'Rent', setAmount: 5000 });
      const hKirana = await personalService.createExpenseHead(rahul.id, { name: 'Kirana / Groceries', setAmount: 3000 });
      const hTransport = await personalService.createExpenseHead(rahul.id, { name: 'Transport & Fuel', setAmount: 1500 });
      const hBills = await personalService.createExpenseHead(rahul.id, { name: 'Utilities & Bills', setAmount: 1000 });

      await personalService.addPersonalExpense(rahul.id, { headId: hRent.id, description: 'Flat rent advance', amount: 2000 });
      await personalService.addPersonalExpense(rahul.id, { headId: hKirana.id, description: 'Supermarket weekly grocery', amount: 1450.50 });
      await personalService.addPersonalExpense(rahul.id, { headId: hBills.id, description: 'Broadband WiFi recharge', amount: 999.00 });
      await personalService.addPersonalExpense(rahul.id, { headId: hTransport.id, description: 'Metro Smart Card topup', amount: 500 });
    }
  }

  // Seed Group: "Flat 402 Roommates"
  const existingGroup = await db.prepare('SELECT id FROM groups WHERE name = ? AND deleted_at IS NULL').get('Flat 402 Roommates');
  if (!existingGroup) {
    const groupRes = await groupService.createGroup(rahul.id, {
      name: 'Flat 402 Roommates',
      invitedUsernames: [priya.username, amit.username, deepak.username]
    });

    const gId = groupRes.group.id;

    // Auto-accept invites for seed accounts
    const invites = await db.prepare('SELECT id, invitee_id FROM group_invitations WHERE group_id = ?').all(gId);
    for (const inv of invites) {
      await groupService.respondToInvitation(inv.invitee_id, inv.id, true);
    }

    // Assign temporary name to Priya
    await groupService.setMemberTemporaryName(rahul.id, gId, priya.id, 'Roommate 1');

    // Add group spending
    await groupService.addGroupExpense(rahul.id, gId, { description: 'Grocery shopping from D-Mart', amount: 1200.00 });
    await groupService.addGroupExpense(priya.id, gId, { description: 'Kitchen utensils & spices', amount: 650.50 });
    await groupService.addGroupExpense(amit.id, gId, { description: 'High-speed Fiber WiFi', amount: 999.00 });
    await groupService.addGroupExpense(deepak.id, gId, { description: 'Water can delivery & cleaning', amount: 350.00 });
  }

  console.log('✅ Seed completed successfully!');
  console.log('\nSeed Credentials:');
  console.log('--------------------------------------------------');
  console.log('Email: rahul@spendly.app  | Password: Password123!');
  console.log('Email: priya@spendly.app  | Password: Password123!');
  console.log('Email: amit@spendly.app   | Password: Password123!');
  console.log('Email: deepak@spendly.app | Password: Password123!');
  console.log('--------------------------------------------------');
}

seed().catch(console.error);
