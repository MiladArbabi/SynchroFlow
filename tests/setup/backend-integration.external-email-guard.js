// tests/setup/backend-integration.external-email-guard.js
//
// GH-1245 TEST SAFETY — fail-closed external email isolation for the Jest
// `backend-integration` project.
//
// scripts/with-test-db.js loads the root .env and forwards process.env to the
// Jest child, so a real RESEND_API_KEY reached integration runs. Fixture
// provisioning (pumpEvents -> FT0 completion materializer ->
// sendSyncCompletedEmail) then sent real Resend requests to synthetic
// `shopify-install+...@lasyncro.internal` members (observed HTTP 422).
//
// Wired as a `setupFiles` entry, so it runs before any test or backend module
// loads:
//   1. The real key is replaced with a non-credential placeholder. It is
//      non-empty only so `new Resend(...)` in email.service still constructs.
//   2. Any fetch to the Resend API is refused before touching the network.
//      The Resend SDK sends through global fetch; email callers are already
//      non-fatal, so the refusal surfaces as a logged delivery failure.
//
// Tests that exercise the delivery transport inject their own `config` and
// `http`, and are unaffected. No production code changes.

'use strict';

const BLOCKED_HOSTS = new Set(['api.resend.com']);

process.env.RESEND_API_KEY = 'test-suppressed-resend-key';

const realFetch = globalThis.fetch;

function requestHost(input) {
  try {
    const url = typeof input === 'string' || input instanceof URL ? input : input && input.url;
    return new URL(String(url)).hostname.toLowerCase();
  } catch (_) {
    return null;
  }
}

globalThis.fetch = async function guardedFetch(input, init) {
  const host = requestHost(input);
  if (host && BLOCKED_HOSTS.has(host)) {
    console.warn(`[TEST_EXTERNAL_EMAIL_BLOCKED] refused fetch to ${host}`);
    throw new Error(`[TEST_EXTERNAL_EMAIL_BLOCKED] external email request to ${host} is forbidden in backend-integration`);
  }
  if (typeof realFetch !== 'function') throw new Error('fetch is unavailable');
  return realFetch(input, init);
};
