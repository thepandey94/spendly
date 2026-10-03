# Spendly — Full-Stack Expense Management Application

Spendly is a real, production-ready expense-management platform designed for individuals, students, roommates, and flatmates. It provides personal budgeting with deterministic billing cycles, collaborative group spending with equal share splitting, real-time multi-device synchronization, offline expense queuing, and permanent immutable historical billing records.

---

## 1. Project Structure

```
Spendly/
├── client/                     # Responsive Single Page Application (Mobile & Desktop)
│   ├── index.html              # HTML5 application shell & dialog modals
│   ├── manifest.json           # Web App Manifest (PWA)
│   ├── sw.js                   # Service Worker (offline caching & Web Push)
│   ├── css/
│   │   ├── variables.css       # Design tokens, color palette, luxury dark theme
│   │   ├── main.css            # Responsive layout, header, drawer sidebar, toast
│   │   ├── components.css      # Buttons, cards, form inputs, dialogs, badges, tables
│   │   └── views.css           # Views styling (Auth, Own Expenses, Split It, Bills, Analytics, Profile)
│   ├── js/
│   │   ├── idb.js              # IndexedDB offline storage & synchronization queue
│   │   ├── ws.js               # WebSocket client for real-time live events & rooms
│   │   ├── store.js            # Reactive application state & INR financial formatting
│   │   ├── api.js              # Centralized fetch API with offline interceptor
│   │   ├── router.js           # Client-side hash router with auth guards
│   │   ├── views/
│   │   │   ├── authView.js     # Registration (Email OTP), Login (User/Email), Password Reset
│   │   │   ├── ownExpensesView.js # Personal heads, entries, budget calculations, billing
│   │   │   ├── splitItView.js  # Groups, member columns, temporary names, settlements
│   │   │   ├── billView.js     # Personal & Group immutable bill snapshots
│   │   │   ├── analyticsView.js# Read-only numerical aggregations & time filters
│   │   │   └── profileView.js  # Profile picture, 30-day username rule, email OTP change
│   │   └── app.js              # Application bootstrapper & network monitors
│   └── icons/                  # PWA icons
├── server/                     # Backend API & Real-Time Engine
│   ├── index.js                # Express & WebSocket HTTP server entry point
│   ├── config.js               # Configuration defaults & environment settings
│   ├── db/
│   │   ├── database.js         # SQLite connector with WAL mode & foreign keys
│   │   ├── schema.sql          # Full normalized relational schema (17 tables)
│   │   └── seed.js             # Realistic test accounts & group seeder
│   ├── middleware/
│   │   ├── auth.js             # JWT authentication & session tracker
│   │   └── upload.js           # Multer secure image upload handler
│   ├── services/
│   │   ├── authService.js      # Auth, OTP, registration, password, account deletion
│   │   ├── emailService.js     # SMTP transport + dev preview fallback
│   │   ├── personalService.js  # Personal heads, cycles, entries, 10k limit, billing
│   │   ├── groupService.js     # Groups, 50-member limit, invites, succession
│   │   ├── settlementService.js# Deterministic cash flow minimization & confirmations
│   │   ├── billService.js      # Immutable bill archive & user view deletion
│   │   ├── analyticsService.js # Numerical aggregations & date filtering
│   │   ├── notificationService.js # In-app notifications & Web Push
│   │   └── websocketService.js # WebSocket rooms & live broadcast
│   └── routes/
│       ├── auth.js             # Authentication & user profile endpoints
│       ├── personal.js         # Personal expense CRUD & billing endpoints
│       ├── groups.js           # Group expense CRUD, billing & settlement endpoints
│       ├── bills.js            # Permanent bill viewing endpoints
│       ├── analytics.js        # Analytics aggregation endpoints
│       ├── notifications.js    # In-app notification endpoints
│       └── push.js             # Web Push subscription endpoints
├── scratch/
│   └── test-suite.js           # Comprehensive automated business logic test suite
├── uploads/avatars/            # Stored user profile avatars
├── .env.example                # Environment variable configuration template
└── package.json                # Project dependencies and npm scripts
```

---

## 2. Key Architecture & Technology Choices

### Frontend Architecture
- **Framework-free Native SPA**: Built with clean, vanilla JavaScript and modern HTML5 APIs for lightning-fast loading, zero framework overhead, and direct DOM reactivity.
- **Design System**: Vanilla CSS using custom design tokens, modern typography (`Outfit` for luxury headings, `Inter` for crisp readable numbers), sleek dark mode styling, and responsive drawer navigation.
- **Offline-First Resilience**: Uses `IndexedDB` (`spendly_offline_db`) to safely record pending personal and group expenses when connectivity drops. Operations use UUID idempotency keys to guarantee duplicate prevention upon reconnection.
- **Push & In-App Notifications**: Service worker push listener integrated with an in-app notification center bell that displays unread counts and interactive buttons (Accept/Decline invitations directly in notifications).

### Backend Architecture
- **Node.js + Express**: RESTful API design with full server-side authorization and validation on every endpoint.
- **Real-Time WebSocket Engine**: Built with `ws` to deliver instant updates for group expenses, member additions, settlement confirmations, and billing status across all connected devices without manual refreshing.
- **SQLite with WAL Mode**: Embedded relational database configured with Write-Ahead Logging (`PRAGMA journal_mode = WAL;`), strict foreign key enforcement (`PRAGMA foreign_keys = ON;`), and atomic transactions (`db.transaction()`). Provides true ACID reliability with zero external database provisioning required.

---

## 3. Financial Handling & Currency Rules

- **Currency**: Indian Rupee (`INR` / `₹`) exclusively.
- **Exact Decimal Arithmetic**: All monetary amounts are internally computed and stored as **integer paise** (1 Rupee = 100 paise).
  - Eliminates floating-point inaccuracies (e.g. `0.1 + 0.2 = 0.30000000000000004` is eliminated).
  - `₹250.50` is stored as `25050` paise.
  - Formatted for display using `new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`.
- **Negative Input Handling**: All negative inputs are automatically converted to their positive absolute equivalents before storage.

---

## 4. Authentication & Security System

### Registration Flow
1. User enters email address.
2. Server generates a cryptographically secure 6-digit OTP (stored with a 10-minute expiry and 5-attempt limit).
3. Server transmits OTP via SMTP (or console / dev-hint fallback in development).
4. User enters OTP.
5. System verifies OTP.
6. User chooses a unique Spendly username (checked globally with case-insensitivity).
7. User creates password (hashed with `bcryptjs`).
8. Account and initial active personal billing cycle are created atomically.
9. JWT token issued and session stored.

### Username Rules
- Globally unique across all users.
- Can be changed a maximum of **once per 30 days** (`last_username_change` timestamp enforced on backend).
- Historical bills preserve the historical username and display name at the time of billing; username changes never rewrite past bills.

### Email Rules
- One email belongs to exactly one Spendly account.
- Changing email requires OTP verification sent to the new address before association.

### Session Management
- Supports simultaneous multi-device logins.
- Logging out from one device invalidates only that device's session without logging out other devices.

---

## 5. Personal Expenses ("Own Expenses")

- **Expense Heads**: User-created categories (Rent, Kirana, Transport, Utilities, Food) with user-defined set amounts.
- **No Automatic Monthly Reset**: Cycles are strictly user-controlled.
- **Cycle Lifecycle**:
  $$\text{Active Cycle} \longrightarrow \text{Billing Action} \longrightarrow \text{Immutable Bill} \longrightarrow \text{Start New Cycle}$$
- **Calculations**:
  - If $\text{Set Amount} \ge \text{Total Spent}$, $\text{Remaining} = \text{Set Amount} - \text{Total Spent}$.
  - If $\text{Total Spent} > \text{Set Amount}$, $\text{Overspent} = \text{Total Spent} - \text{Set Amount}$.
- **10,000 Entry Limit**: Enforced server-side per personal cycle.
- **Billing Atomicity**: Billing locks the cycle, calculates final snapshots, generates a permanent record in `personal_bills`, and prompts the user to "Start a New Cycle" to resume spending.

---

## 6. Collaborative Groups ("Split It")

- **Capacity**: Maximum 50 members (1 Admin + 49 Members).
- **Invitations**: Admin invites by unique Spendly username. Invitations must be accepted before membership is granted.
- **Temporary Display Names**: Admin can assign group-specific temporary names (e.g. "Roommate 1") that do not alter the user's global username.
- **Membership Lock During Active Cycle**: Adding or removing members or approving leave requests is strictly blocked while an active cycle has spending entries:
  > *"Complete billing before changing group membership."*
- **Admin Succession Rule**: If an admin leaves or deletes their account, the **first member originally added by that admin** (lowest `order_index` in `group_members`) automatically succeeds as the new group admin.

---

## 7. Deterministic Settlement Algorithm

When group billing occurs:
1. Total group expenditure $T = \sum \text{spent}_i$ in paise.
2. Equal share per person $S = \lfloor T / N \rfloor$, with remainder $R = T \pmod N$ assigned deterministically to the top spenders.
3. Net balances computed: $\text{balance}_i = \text{spent}_i - \text{share}_i$, strictly ensuring $\sum \text{balance}_i = 0$.
4. Debtors ($\text{balance} < 0$) and Creditors ($\text{balance} > 0$) are matched using greedy cash flow minimization to eliminate redundant intermediate payments.
5. Exact paise precision is preserved. Total money paid by debtors equals total money received by creditors down to the single paisa.

### Two-Party Settlement Status Flow
1. Bill generated $\longrightarrow$ Settlement record created with `status: 'pending'`.
2. Payer clicks **Mark as Paid** $\longrightarrow$ `status: 'pending_confirmation'`, receiver receives notification.
3. Receiver clicks **Confirm Received** $\longrightarrow$ `status: 'completed'`, permanently locked.
4. If receiver disputes, status reverts to `pending` or remains pending confirmation. Settlements are never silently auto-completed.

---

## 8. Analytics & Permanent Bills

- **Permanent Bills**:
  - Personal and Group bills are stored immutably.
  - Users can delete a bill record from their view without corrupting shared historical records or affecting other group members.
  - External export (PDF, CSV, Excel) is intentionally omitted per Section 49.
- **Analytics**:
  - Numerical and table-based summaries.
  - Overall spending, personal spending, group contributions, amounts owed, and amounts receivable.
  - Time filters: All Time, Today, This Month, and Custom Date Range.

---

## 9. Environment Variables (`.env`)

| Variable | Description | Default |
|---|---|---|
| `PORT` | Web & API server port | `3000` |
| `NODE_ENV` | Environment mode (`development` / `production`) | `development` |
| `JWT_SECRET` | Secret key for signing session tokens | Production secret |
| `DB_PATH` | Path to SQLite database file | `./server/spendly.db` |
| `SMTP_HOST` | SMTP server host | `""` |
| `SMTP_PORT` | SMTP server port | `587` |
| `SMTP_USER` | SMTP username | `""` |
| `SMTP_PASS` | SMTP password | `""` |
| `SMTP_FROM` | Outgoing email address | `Spendly <noreply@spendly.app>` |
| `VAPID_PUBLIC_KEY`| Web Push VAPID public key | `""` |
| `VAPID_PRIVATE_KEY`| Web Push VAPID private key | `""` |

---

## 10. Local Setup & Running Instructions

### Prerequisites
- Node.js (v18+ or v24+)
- npm (v9+)

### Installation
```bash
# 1. Install dependencies
npm install

# 2. Seed development accounts and sample group
npm run seed

# 3. Run automated test suite
npm test

# 4. Start the application
npm start
```

### Accessing the Web Application
Open your browser and navigate to:
```
http://localhost:3000
```

### Seed Accounts (Password for all: `Password123!`):
- `rahul@spendly.app` (Admin of "Flat 402 Roommates")
- `priya@spendly.app` (Member "Roommate 1")
- `amit@spendly.app` (Member)
- `deepak@spendly.app` (Member)
