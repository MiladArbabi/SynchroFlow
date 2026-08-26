# Testing Strategy & Infrastructure Playbook

**Established:** 2026-08-26
**Scope:** Automated testing across SynchroFlow / laSyncro
**Status:** Canonical testing contract

---

## 1. Purpose

Automated tests exist to protect consequential product behavior.

A test should answer:

> **What behavior or invariant would materially hurt the merchant, product,
> security boundary, or operational workflow if it regressed?**

Tests should primarily protect:

- business rules and commercial invariants;
- state transitions;
- persistence and atomicity;
- inventory correctness;
- authorization and tenant isolation;
- idempotency and retry behavior;
- migrations and schema invariants;
- provider and integration contracts;
- critical user journeys.

Tests should generally **not** exist merely to freeze:

- incidental copy;
- exact headings or paragraph wording;
- arbitrary DOM structure;
- card or wrapper shape;
- presentation details that may legitimately change.

Exact text or structure is appropriate only where it is itself contractual,
such as accessibility labels, security/error contracts, legal or commercial
disclosures, API contracts, or a critical interaction boundary.

---

## 2. Default Test Commands

### Safe foundation gate

```sh
npm test
```

Equivalent to:

```sh
npm run test:foundation
```

and currently runs:

```text
test:config
→ test:db-safety
→ test:contract
```

This path is DB-free.

It must never:

- reset the development database;
- migrate the development database;
- seed the development database;
- execute legacy DB-backed Jest suites implicitly.

`npm run test:fast` currently points to the same safe foundation.

---

## 3. Backend Integration Tests

```sh
npm run test:integration
```

Backend integration tests run through:

```text
scripts/with-test-db.js
```

Lifecycle:

```text
generate synchroflow_test_*
→ fail-closed safety validation
→ create DB with migration role
→ run all migrations
→ verify runtime access as sf_app
→ execute backend-integration Jest project serially
→ close connections
→ drop disposable DB
→ prove DB is gone
```

### Database safety invariants

The integration harness must never operate destructively unless:

- `NODE_ENV=test`;
- the generated DB matches `^synchroflow_test_[A-Za-z0-9_]+$`;
- the test DB differs from normal `PGDATABASE`;
- runtime and migration roles are both present;
- runtime and migration roles are different.

Administration and migrations use the privileged migration role.

Application/runtime verification uses the restricted runtime role (`sf_app`).

Integration databases start from **migrations only**. There is no implicit
`full_identity` seed requirement.

Legacy DB-backed tests remain serial until their fixture isolation is strong
enough for safe parallel execution.

---

## 4. Jest Project Ownership

Every Jest `.test.ts` / `.test.tsx` file must belong to exactly one configured
Jest project.

Permanent invariant:

```text
0 project owners  → configuration failure
2+ project owners → configuration failure
```

Validate with:

```sh
npm run test:config
```

Current project roles:

- `backend-legacy` — transitional ownership for historical backend tests that
  have not yet been classified as genuinely pure vs DB-backed;
- `backend-integration` — explicit real-DB / real-route integration tests;
- `contract` — architecture and invariant contracts;
- `frontend` — historical frontend/JSDOM suite.

`backend-legacy` is transitional and is not the desired permanent definition
of a unit-test layer.

---

## 5. Frontend Tests

```sh
npm run test:frontend
```

The historical frontend suite is currently **diagnostic/non-gating**.

It contains substantial legacy coverage whose value varies, including tests
that assert obsolete product surfaces, copy, presentation shape, or historical
behavior.

Do not repair a red legacy frontend test merely because it is red.

Before repairing it, determine:

1. What invariant does it protect?
2. Is that invariant still part of the product?
3. Would breaking it materially affect the merchant or system?

Then:

```text
meaningful current invariant → modernize the test
obsolete/incidental contract → remove the test
```

New frontend tests should focus on critical interaction behavior rather than
copy or layout stability.

---

## 6. Deprecated and Paused Product Coverage

Deprecated product surfaces should not be kept alive by Jest compatibility
work solely to make historical tests green.

Paused product surfaces may retain tests for future reactivation, but those
tests should not become an active release gate while the product surface itself
is paused.

When old coverage is touched:

```text
still consequential → modernize
obsolete            → delete
paused              → preserve intentionally, non-gating
```

---

## 7. Contract Tests

```sh
npm run test:contract
```

Contract tests protect architecture and invariant boundaries.

Examples:

- every Jest test has exactly one owner;
- destructive test-DB operations fail closed;
- canonical authority remains in the intended layer;
- forbidden architectural dependencies remain forbidden.

Contract tests should be deterministic and normally DB-free.

---

## 8. Test Database Safety Contracts

```sh
npm run test:db-safety
```

`scripts/test-db-safety.js` is the pure safety boundary.

It performs no SQL, shell execution, filesystem deletion, or environment
mutation.

It validates destructive-operation eligibility before any disposable DB
lifecycle command is allowed to proceed.

Do not duplicate these safety rules inside other scripts. Reuse the canonical
module.

---

## 9. External Providers

Normal automated tests must not make real calls to:

- Stripe;
- Shopify;
- email providers;
- push providers;
- other external side-effecting services.

Provider acceptance/E2E must be an explicit, separately authorized path.

Mocking should preserve the actual boundary being tested rather than mock away
the business behavior itself.

---

## 10. Temporary `--forceExit` Debt

`test:integration` currently uses Jest `--forceExit` as a **temporary
compatibility measure**.

This is not the desired lifecycle model.

A reproduced asynchronous email path can remain active after test teardown and
keep Jest alive. That open-handle defect must be addressed separately.

The target state is:

```text
tests complete
→ owned resources close
→ Jest exits naturally
```

Do not remove `--forceExit` until natural termination has been proven.

Do not treat its presence as evidence that the underlying resource lifecycle is
healthy.

---

## 11. Playwright E2E

```sh
npm run test:e2e
```

Playwright is explicit and separate from the default foundation gate.

Use E2E for critical journeys or boundaries that cannot be adequately proven
at a lower-cost test layer.

Prefer API-level proof when UI rendering is not the behavior under test.

Do not use E2E to freeze cosmetic copy or layout.

The current Playwright path is not yet backed by the disposable Jest
integration DB harness; its environment must be prepared deliberately.

---

## 12. Test Strategy Per Issue

Every engineering issue must explicitly decide its test strategy.

Possible layers include:

- unit;
- API integration;
- DB invariant;
- migration;
- worker/outbox;
- concurrency;
- contract/static;
- Playwright;
- provider E2E;
- live browser verification.

Automated tests are not mandatory for every trivial change.

But consequential defects — especially billing, fulfillment, inventory, auth,
tenant isolation, migrations, Shopify boundaries, entitlements, and durable
outbox behavior — should normally leave permanent regression protection.

When practical:

```text
confirmed defect
→ write failing regression contract
→ prove RED
→ implement fix
→ run same contract
→ prove GREEN
→ run neighboring regression suites
```

Never weaken an assertion merely to make a red test green.

---

## 13. Test Value Rules

### TEST-VALUE-01

Automated tests must protect consequential product behavior, business
invariants, security/tenant boundaries, persistence, state transitions,
integrations, or critical user journeys.

Tests whose primary purpose is asserting incidental copy, presentation
structure, or easily-changing UI shape should not be added unless that exact
presentation is itself contractual.

### TEST-VALUE-02

A red legacy test is not automatically a product defect.

Before repairing it:

- identify the invariant it protects;
- verify that invariant is still relevant;
- delete or replace the test if it protects obsolete behavior.

---

## 14. Current Command Classification

### Safe DB-free

```text
npm test
npm run test:foundation
npm run test:fast
npm run test:config
npm run test:contract
npm run test:db-safety
```

### Safe disposable-DB

```text
npm run test:db-lifecycle
npm run test:integration
```

### Discovery only

```text
npm run test:backend:legacy:list
npm run test:integration:list
```

### Legacy / diagnostic

```text
npm run test:frontend
```

### Explicit E2E

```text
npm run test:e2e
npm run test:e2e:ui
```

---

## 15. Standing Safety Rule

The normal development database is never an automated integration-test
scratchpad.

If a new automated DB test needs real PostgreSQL behavior, route it through the
disposable `synchroflow_test_*` infrastructure rather than resetting
`PGDATABASE`.

This rule takes precedence over historical test patterns.
