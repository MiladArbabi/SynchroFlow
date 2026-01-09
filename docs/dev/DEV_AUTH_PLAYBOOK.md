## `DEV_AUTH_PLAYBOOK.md`

### Purpose

Prevent identity corruption, haunted UI states, and irreversible auth bugs during development.

This system **assumes identity integrity**. If you violate it, the UI will lie to you.

---

## 🔒 Non-Negotiable Rules

### ❌ NEVER do the following

* Manually `INSERT`, `UPDATE`, or `DELETE` from:

  * `users`
  * `shops`
  * `shop_memberships`
  * `refresh_tokens`
* Test `/auth/login` before verifying DB state
* Reuse a database after **partial** resets
* “Fix” auth issues by poking SQL

Violating any of these **will** recreate:

* phantom logins
* stuck lifecycle gates
* missing layout / outlet rendering
* infinite redirects

---

## ✅ Allowed & Required Flows

### 1️⃣ Database resets (ONLY this way)

```bash
npm run dev:setup
```

This atomically:

* drops DB
* recreates DB
* runs migrations
* runs seeds

If DB state is questionable → **reset it fully**.

---

### 2️⃣ Creating users (ONLY two ways)

#### Option A — Manual testing (preferred)

```http
POST /api/v1/auth/register
```

This **atomically** creates:

* user
* shop
* shop_membership (owner)

#### Option B — Seeds (advanced)

* Add users to Knex seed files
* Let migrations + seeds define identity
* Never mix seeds with manual SQL inserts

---

### 3️⃣ Pre-login verification (MANDATORY)

Before calling `/auth/login`, run:

```sql
-- User exists
SELECT id, email FROM users;

-- Exactly ONE active membership
SELECT *
FROM shop_memberships
WHERE user_id = <USER_ID>
  AND revoked_at IS NULL;

-- Shop exists
SELECT * FROM shops WHERE id = <SHOP_ID>;
```

If any of these fail → **STOP**.
Fix state or reset DB.

---

## 🔑 Session & Token Model (Know This)

* Each login **revokes all previous sessions**
* Exactly **one active refresh token** is allowed
* Seeing revoked tokens is **expected and correct**

Example:

```text
✔ 1 active token
✔ N revoked tokens
✘ 2 active tokens (BUG)
```

This behavior is intentional and prevents session compromise.

---

## 🧠 Development Mental Model

```
REGISTER
  ↓
(user + shop + membership)   ← identity is immutable
  ↓
LOGIN
  ↓
(single active session)
```

If identity feels “off”, **reset — don’t patch**.

---

## 🚨 If You Break the Rules

Symptoms you will see:

* Login succeeds but UI stays blank
* AppLayout disappears
* Lifecycle gates never resolve
* Redirect loops

Fix:

```bash
npm run dev:setup
→ re-register user
```

Do **not** debug UI until DB identity is clean.

---

## ✅ Final Law

> **Auth bugs are almost never frontend bugs.**
> They are corrupted identity graphs.

Treat identity as write-once during dev.

---