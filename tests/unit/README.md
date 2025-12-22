# Unit Testing Guidelines (Updated)

## 🎯 Core Principle (Non-Negotiable)

**Unit tests run against the real database schema.**
No fake columns. No imaginary tables. No partial inserts.

If the schema changes, tests must change.

---

## 🧠 Mental Model

There are **two valid unit-testing styles** in this codebase:

### 1️⃣ Schema-Backed Unit Tests (Preferred)

Used for:

* onboarding
* lifecycle / state machines
* FT0 / FT1 / activation logic
* anything involving persistence guarantees

**Characteristics**

* Uses real Knex + test DB
* Respects NOT NULL / FK constraints
* Uses seed helpers
* No `jest.mock('api-db')`

> FT0CompletionService is the reference implementation.

---

### 2️⃣ Mocked Unit Tests (Allowed, but limited)

Used for:

* pure computation
* formatting
* query composition
* defensive logic

Mocking **must** follow the factory pattern (see below).

---

## 📁 Directory Structure

```
tests/unit/
├── onboarding/        # Activation, FT0–FTn, lifecycle logic
├── api/               # Business services (non-lifecycle)
├── ui/                # React component tests
├── helpers/           # Seed + test utilities (REQUIRED)
└── README.md
```

---

## 🌱 Seeding Rules (CRITICAL)

### Never inline inserts in tests

❌ **Wrong**

```ts
await db('shops').insert({ ... });
```

✅ **Correct**

```ts
await seedShopAndUser({ shopId, userId });
await seedIntegration({ shopId, syncStatus: 'COMPLETED' });
await seedCanonicalOrder({ shopId });
await seedCanonicalProduct({ shopId });
```

### Why

* Schema changes once → helpers update once
* Tests stay readable
* DRY is enforced structurally, not by discipline

---

## 🧪 Canonical Data Rules

Canonical tables are **strict** by design.

### canonical_orders requires (minimum)

* shop_id
* canonical_order_id
* platform
* platform_order_id
* currency
* total_price
* subtotal_price
* total_tax
* order_created_at
* order_updated_at

### canonical_products

* **Primary key is `canonical_product_id` (integer)**
* There is **no `id` column**

❌ Never do:

```ts
.count('id')
```

✅ Always do:

```ts
.count('* as count')
```

---

## ✅ Correct Existence Checks

**Always count rows, never columns**

```ts
const { count } = await db('canonical_products')
  .where({ shop_id })
  .count('* as count')
  .first();
```

This is schema-proof.

---

## 🔁 Idempotency Testing Pattern

When testing idempotent services:

```ts
const first = await Service.evaluate(shopId);
const second = await Service.evaluate(shopId);

expect(first.completed).toBe(true);
expect(second.alreadyCompleted).toBe(true);

const rows = await db('state_table').where({ shop_id });
expect(rows.length).toBe(1);
```

Idempotency is **observable behavior**, not an implementation detail.

---

## 🧼 Cleanup Rules

Every schema-backed test **must** clean up in `beforeEach`:

```ts
await db('ft0_state').where({ shop_id }).del().catch(() => {});
await db('integrations').where({ shop_id }).del();
await db('canonical_orders').where({ shop_id }).del();
await db('canonical_products').where({ shop_id }).del();
await db('users').where({ id: userId }).del();
await db('shops').where({ id: shopId }).del();
```

No shared state. Ever.

---

## 🧪 Example: Gold-Standard Test File

Use this as the **template** going forward:

```
tests/unit/onboarding/ft0-completion.service.test.ts
```

If a new test doesn’t look like this structurally, it’s probably wrong.

---

## 🧯 Mocked DB Pattern (Only When Needed)

If mocking `api-db`, **factory pattern is mandatory**.

```ts
jest.mock('api-db', () => {
  const instance = {
    where: jest.fn().mockReturnThis(),
    count: jest.fn().mockReturnThis(),
    first: jest.fn(),
  };

  const db = jest.fn(() => instance);
  (db as any).fn = { now: jest.fn(() => 'now') };

  return { __esModule: true, default: db };
});
```

If you see hoisting errors → you violated this rule.

---

## 🚨 What We Do NOT Do Anymore

* ❌ Mock DB for lifecycle logic
* ❌ Insert partial rows
* ❌ Guess column names
* ❌ Count non-existent `id` columns
* ❌ Repeat seed logic inline
* ❌ Let tests pass by accident

---

## 🧠 Final Rule (Tattoo This)

> **If a test passes without respecting the real schema, it is lying.**

FT0 is now:

* schema-correct
* idempotent
* deterministic
* future-proof

This README now reflects that reality.