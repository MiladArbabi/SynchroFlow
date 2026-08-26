// tests/setup/jest.shared.js
//
// TEST-INFRA-FOUNDATION Slice 1B.
//
// Loaded by BOTH tests/setup/jest.node.js and tests/setup/jest.ui.js.
// Concerns here are either proven required by Node-owned tests and harmless
// to UI, or are being preserved uniformly across every project this slice
// because Slice 1B's dependency preflight could not find a single test that
// provably requires (or would tolerate losing) the behavior — narrowing that
// is deferred to Slice 4, not decided here.
//
// Keep this file free of ESM `import` so Jest can require() it early
// (matches the original root jest.setup.js constraint).

// Ensure test environment is set.
// Proven Node-required: apps/backend/src/queue.ts, apps/backend/src/bootstrap/env.ts,
// apps/backend/src/api/auth/auth.routes.ts, apps/backend/src/api/auth/auth.test.controller.ts,
// and apps/backend/src/services/ft2-evaluator.service.ts all branch on
// process.env.NODE_ENV === 'test'. Harmless to UI.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// Stripe webhook verification (test-only secret).
// Proven Node-required: tests/unit/backend/billing/stripe.webhook.idempotency.persistent.test.ts
// (backend-legacy) signs requests with this secret via tests/unit/helpers/stripeTestSignature.
// Harmless to UI.
process.env.STRIPE_WEBHOOK_SECRET =
  process.env.STRIPE_WEBHOOK_SECRET || 'test_stripe_secret';

// Silence noisy console.error in tests (optional).
//
// Slice 1B preflight found no Node-owned test that asserts on this spy or
// would fail without it, but it currently applies uniformly to every Jest
// project via the single root jest.setup.js. Per this slice's explicit
// instruction to preserve current console.error suppression behavior and NOT
// change console policy yet, it is kept here — shared — so behavior is
// unchanged for every project. Narrowing/removing this belongs to Slice 4.
try { jest.spyOn(console, 'error').mockImplementation(() => {}); } catch (_) {}
