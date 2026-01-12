import { test, expect } from '@playwright/test';
import { createAuthenticatedApiContext } from './utils/api-auth';

/**
 * Lifecycle E2E — Backend Authority Lock
 *
 * This test enforces:
 * - Snapshot-driven lifecycle
 * - Explicit promotions
 * - Idempotency
 * - FT1 and FT2 write authority
 *
 * UI is intentionally ignored.
 */
test.describe('Lifecycle — backend authority', () => {
  test('FT_MINUS_ONE → FT1 → FT2', async () => {
  const request = await createAuthenticatedApiContext();

    // ─────────────────────────────────────────────
    // 1. Initial lifecycle
    // ─────────────────────────────────────────────
    const initial = await request.get('/api/v1/lifecycle');
    expect(initial.ok()).toBeTruthy();

    const initialBody = await initial.json();
    expect(initialBody.phase).toBe('FT_MINUS_ONE');

    // ─────────────────────────────────────────────
    // 2. Confirm FT1
    // ─────────────────────────────────────────────
    const ft1Confirm = await request.post('/api/v1/lifecycle/ft1/confirm');
    expect(ft1Confirm.ok()).toBeTruthy();

    const ft1Body = await ft1Confirm.json();
    expect(ft1Body.phase).toBe('FT1');

    // Verify snapshot
    const afterFt1 = await request.get('/api/v1/lifecycle');
    const afterFt1Body = await afterFt1.json();
    expect(afterFt1Body.phase).toBe('FT1');

    // ─────────────────────────────────────────────
    // 3. Evaluate FT2 eligibility (read-only)
    // ─────────────────────────────────────────────
    const evalFt2 = await request.get('/api/v1/lifecycle/ft2/evaluate');
    expect(evalFt2.ok()).toBeTruthy();

    const evalBody = await evalFt2.json();
    expect(evalBody.eligible).toBe(true);

    // ─────────────────────────────────────────────
    // 4. Confirm FT2
    // ─────────────────────────────────────────────
    const ft2Confirm = await request.post('/api/v1/lifecycle/ft2/confirm');
    expect(ft2Confirm.ok()).toBeTruthy();

    const ft2Body = await ft2Confirm.json();
    expect(ft2Body.phase).toBe('FT2');

    // Verify snapshot
    const afterFt2 = await request.get('/api/v1/lifecycle');
    const afterFt2Body = await afterFt2.json();
    expect(afterFt2Body.phase).toBe('FT2');

    // ─────────────────────────────────────────────
    // 5. Idempotency check
    // ─────────────────────────────────────────────
    const ft2ConfirmAgain = await request.post('/api/v1/lifecycle/ft2/confirm');
    expect(ft2ConfirmAgain.ok()).toBeTruthy();

    const ft2AgainBody = await ft2ConfirmAgain.json();
    expect(ft2AgainBody.phase).toBe('FT2');
  });
});