-- Spendly Relational Database Schema
-- Optimized for SQLite with WAL mode, foreign key enforcement, and ACID transactions

PRAGMA foreign_keys = ON;

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL COLLATE NOCASE,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    bio TEXT,
    avatar_url TEXT,
    is_admin INTEGER DEFAULT 0,
    last_username_change INTEGER DEFAULT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users(is_admin);

-- 2. Email OTPs Table
CREATE TABLE IF NOT EXISTS email_otps (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL COLLATE NOCASE,
    otp_code TEXT NOT NULL,
    purpose TEXT NOT NULL, -- 'registration', 'reset_password', 'change_email'
    attempts INTEGER DEFAULT 0,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_otps_lookup ON email_otps(email, purpose, expires_at);

-- 3. Multi-Device User Sessions
CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_info TEXT,
    token TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_active_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token);

-- 4. Personal Cycles
CREATE TABLE IF NOT EXISTS personal_cycles (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cycle_number INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active', 'billed')),
    created_at INTEGER NOT NULL,
    billed_at INTEGER DEFAULT NULL,
    UNIQUE(user_id, cycle_number)
);

CREATE INDEX IF NOT EXISTS idx_personal_cycles_user_status ON personal_cycles(user_id, status);

-- 5. Personal Expense Heads
CREATE TABLE IF NOT EXISTS personal_expense_heads (
    id TEXT PRIMARY KEY,
    cycle_id TEXT NOT NULL REFERENCES personal_cycles(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    set_amount INTEGER NOT NULL CHECK(set_amount >= 0), -- in paise
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_personal_heads_cycle ON personal_expense_heads(cycle_id);

-- 6. Personal Spending Entries (up to 10,000 per cycle)
CREATE TABLE IF NOT EXISTS personal_expenses (
    id TEXT PRIMARY KEY,
    cycle_id TEXT NOT NULL REFERENCES personal_cycles(id) ON DELETE CASCADE,
    head_id TEXT NOT NULL REFERENCES personal_expense_heads(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK(amount >= 0), -- in paise
    idempotency_key TEXT UNIQUE,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_personal_expenses_head ON personal_expenses(head_id);
CREATE INDEX IF NOT EXISTS idx_personal_expenses_cycle ON personal_expenses(cycle_id);

-- 7. Permanent Personal Bills (Immutable snapshots)
CREATE TABLE IF NOT EXISTS personal_bills (
    id TEXT PRIMARY KEY,
    cycle_id TEXT UNIQUE NOT NULL REFERENCES personal_cycles(id),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cycle_number INTEGER NOT NULL,
    total_set_amount INTEGER NOT NULL,
    total_spent INTEGER NOT NULL,
    total_remaining INTEGER NOT NULL,
    total_overspent INTEGER NOT NULL,
    entry_count INTEGER NOT NULL,
    bill_snapshot_json TEXT NOT NULL,
    hidden_by_user INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_personal_bills_user ON personal_bills(user_id, created_at DESC);

-- 8. Groups Table (Max 50 members)
CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    admin_id TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_groups_admin ON groups(admin_id);

-- 9. Group Members
CREATE TABLE IF NOT EXISTS group_members (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
    temporary_name TEXT DEFAULT NULL,
    order_index INTEGER NOT NULL, -- preserved member addition order for admin succession
    joined_at INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active', 'left', 'removed')),
    leave_requested_at INTEGER DEFAULT NULL,
    UNIQUE(group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_lookup ON group_members(group_id, status);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);

-- 10. Group Invitations
CREATE TABLE IF NOT EXISTS group_invitations (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    inviter_id TEXT NOT NULL REFERENCES users(id),
    invitee_id TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'declined')),
    created_at INTEGER NOT NULL,
    responded_at INTEGER DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_group_invitations_invitee ON group_invitations(invitee_id, status);

-- 11. Group Cycles
CREATE TABLE IF NOT EXISTS group_cycles (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    cycle_number INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active', 'billed')),
    created_at INTEGER NOT NULL,
    billed_at INTEGER DEFAULT NULL,
    UNIQUE(group_id, cycle_number)
);

CREATE INDEX IF NOT EXISTS idx_group_cycles_lookup ON group_cycles(group_id, status);

-- 12. Group Expenses
CREATE TABLE IF NOT EXISTS group_expenses (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    cycle_id TEXT NOT NULL REFERENCES group_cycles(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    description TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK(amount >= 0), -- in paise
    idempotency_key TEXT UNIQUE,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_group_expenses_cycle ON group_expenses(cycle_id);
CREATE INDEX IF NOT EXISTS idx_group_expenses_user ON group_expenses(user_id);

-- 13. Permanent Group Bills (Immutable snapshot)
CREATE TABLE IF NOT EXISTS group_bills (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(id),
    cycle_id TEXT UNIQUE NOT NULL REFERENCES group_cycles(id),
    cycle_number INTEGER NOT NULL,
    group_name TEXT NOT NULL,
    total_spent INTEGER NOT NULL,
    member_count INTEGER NOT NULL,
    equal_share INTEGER NOT NULL,
    bill_snapshot_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_group_bills_group ON group_bills(group_id, created_at DESC);

-- 14. User Hidden Bills (Allows hiding bills without deleting historical records)
CREATE TABLE IF NOT EXISTS user_hidden_bills (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bill_id TEXT NOT NULL,
    bill_type TEXT NOT NULL CHECK(bill_type IN ('personal', 'group')),
    created_at INTEGER NOT NULL,
    UNIQUE(user_id, bill_id, bill_type)
);

-- 15. Settlements
CREATE TABLE IF NOT EXISTS settlements (
    id TEXT PRIMARY KEY,
    bill_id TEXT NOT NULL REFERENCES group_bills(id) ON DELETE CASCADE,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    payer_id TEXT NOT NULL REFERENCES users(id),
    receiver_id TEXT NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL CHECK(amount > 0), -- in paise
    status TEXT NOT NULL CHECK(status IN ('pending', 'pending_confirmation', 'completed')),
    paid_at INTEGER DEFAULT NULL,
    confirmed_at INTEGER DEFAULT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_settlements_bill ON settlements(bill_id);
CREATE INDEX IF NOT EXISTS idx_settlements_payer ON settlements(payer_id);
CREATE INDEX IF NOT EXISTS idx_settlements_receiver ON settlements(receiver_id);

-- 16. In-App Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    data_json TEXT,
    read INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at DESC);

-- 17. Push Subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    keys_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

-- 18. User Hidden Groups (Personal Removal of Billed Groups)
CREATE TABLE IF NOT EXISTS user_hidden_groups (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    UNIQUE(user_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_user_hidden_groups_user ON user_hidden_groups(user_id);

-- 19. Admin Audit Logs
CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    admin_username TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    details_json TEXT,
    ip_address TEXT,
    status TEXT NOT NULL DEFAULT 'success',
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created ON admin_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_action ON admin_audit_logs(action);

-- 20. User Avatars (Persistent Storage for Ephemeral Cloud Deployments)
CREATE TABLE IF NOT EXISTS user_avatars (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    image_data TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_avatars_filename ON user_avatars(filename);
