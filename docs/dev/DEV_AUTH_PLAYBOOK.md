# `DEV_AUTH_PLAYBOOK.md`

## Purpose

Prevent **identity corruption**, **haunted UI states**, and **irreversible auth bugs** during development.

This system **assumes identity integrity**.
If you violate that assumption, the UI will lie to you, and debugging will waste hours.

This document exists to stop that.

---

## 🔒 Non-Negotiable Rules

### ❌ NEVER do the following

* Manually `INSERT`, `UPDATE`, or `DELETE` rows from:

  * `users`
  * `shops`
  * `shop_memberships`
  * `refresh_tokens`
* Test `/api/v1/auth/login` before verifying database identity state
* Reuse a database after **partial** resets
* “Fix” auth issues by poking SQL directly
* Assume seeded users are loginable

Violating any of these **will** recreate:

* phantom logins
* 401 / 403 loops
* stuck lifecycle gates
* missing layouts or outlets
* infinite redirects
* “it worked yesterday” bugs

If you see these symptoms, **stop immediately**.

---

## ✅ Allowed & Required Flows

### 1️⃣ Database resets (ONLY this way)

```bash
npm run dev:setup
```

This atomically:

* stops relying on prior state
* drops the database
* recreates the database
* runs **all migrations**
* runs **dev seeds**

If database state is questionable → **reset fully**.
Partial fixes are forbidden.

---

### 2️⃣ Creating users (ONLY two valid paths)

#### ✅ Option A — Interactive development (REQUIRED for UI login)

```http
POST /api/v1/auth/register
```

This is the **only** method that produces a **loginable identity**.

It atomically creates:

* `user`
* `shop`
* `shop_membership` (owner)
* valid auth invariants
* valid lifecycle assumptions

> **If login or UI interaction is involved, this is the only allowed path.**

---

#### ⚠️ Option B — Seeds (NON-LOGINABLE by default)

Seeds may create users **only** for:

* background services
* analytics bootstrapping
* lifecycle test scenarios
* schema validation
* non-interactive fixtures

Seeded users:

* ❌ MUST NOT be used to log in
* ❌ MUST NOT be used to test UI auth
* ❌ MUST NOT be assumed to have valid memberships
* ✅ MAY intentionally violate identity invariants

If you need a loginable user → **do not use seeds**.

---

## 🧪 Dev Seed Modes (Important)

Dev seeds support **explicit identity intent**.

### Default behavior (safe)

```text
DEV_SEED_MODE not set
```

Seeds will create:

* shops ✔
* users ✔
* memberships ❌

Result:

* User **exists**
* Login **correctly fails** with `403 NO_ACTIVE_SHOP_MEMBERSHIP`

This protects you from false confidence.

---

### Loginable dev seed (explicit, opt-in)

```bash
DEV_SEED_MODE=full_identity npm run dev:setup
```

Seeds will create:

* shop ✔
* user ✔
* active shop_membership ✔ (owner)

Result:

* Login **works**
* Identity invariants are satisfied
* Behavior matches production

Logs will explicitly say:

```
[DEV_SEED] Full identity seeded — login ENABLED
```

This mode is **intentional**, not default.

---

## 3️⃣ Pre-login verification (MANDATORY)

Before calling `/api/v1/auth/login`, verify identity:

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

### Interpretation

* ❌ No user → login must fail
* ❌ No active membership → login must fail
* ❌ Multiple active memberships → bug
* ✅ Exactly one active membership → login allowed

If any check fails → **STOP**.
Reset DB or re-register the user.

---

## 🔑 Session & Token Model (Know This)

* Each login **revokes all previous sessions**
* Exactly **one active refresh token** is allowed per user
* Revoked tokens remaining in DB is **expected**

Example:

```text
✔ 1 active refresh token
✔ N revoked refresh tokens
✘ 2 active refresh tokens (BUG)
```

This behavior is deliberate and prevents session replay.

---

## 🧠 Development Mental Model

```
REGISTER
  ↓
(user + shop + membership)   ← identity becomes immutable
  ↓
LOGIN
  ↓
(single active session)
```

If identity feels “off”:

> **Reset — don’t patch.**

---

## 🚫 Seeded Users Are NOT Loginable (By Design)

Seeded users **must never** be used for interactive login unless explicitly opted in via `DEV_SEED_MODE=full_identity`.

### Why this rule exists

Seeds are for:

* schema validation
* lifecycle bootstrapping
* analytics scaffolding
* background jobs
* test fixtures

They are **not identity-authoritative**.

Seeded users may:

* lack active `shop_memberships`
* bypass auth invariants
* violate lifecycle assumptions

Attempting to log in with seeded users will correctly result in:

* `403 NO_ACTIVE_SHOP_MEMBERSHIP`
* `401 Invalid credentials`
* blocked lifecycle resolution

This is **correct behavior**, not a bug.

---

## 🚨 Common False Assumption (DO NOT FALL FOR THIS)

> “The seeded test user should be able to log in.”

❌ False.

Typical failure loop:

1. Try to log in with seeded user → fails
2. Try to re-register same email → `409`
3. Retry login → still fails
4. Panic ensues

This is **identity protection**, not breakage.

Correct fix:

```bash
npm run dev:setup
→ POST /api/v1/auth/register
→ login
```

---

## 🧯 If You Break the Rules

Symptoms you will see:

* Login succeeds but UI is blank
* AppLayout disappears
* Lifecycle never resolves
* Redirect loops
* Auth errors that “don’t make sense”

### Fix (always the same)

```bash
npm run dev:setup
→ re-register user
```

Do **not** debug frontend code until identity is clean.

---

## ✅ Final Law

> **Auth bugs are almost never frontend bugs.**
> They are corrupted identity graphs.

Treat identity as **write-once** during development.

If you respect this document, the system will tell you the truth.
