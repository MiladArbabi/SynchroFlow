import { test, expect } from '@playwright/test';
import { createAuthenticatedApiContext } from '../utils/api-auth';

/**
 * NON-REGRESSION INVARIANT
 * -----------------------
 * Once FT2 is reached:
 * - lifecycle MUST remain FT2
 * - no refresh or API call may regress it
 * - backend is the sole authority
 */
test.describe('Lifecycle invariant — FT2 is terminal', () => {
  test('FT2 never regresses after promotion', async ({ page }) => {
    const api = await createAuthenticatedApiContext();

    // ─────────────────────────────────────────────
    // 1. Ensure we are in FT2 (idempotent)
    // ─────────────────────────────────────────────
    await api.post('/api/v1/lifecycle/ft2/confirm');

    const initial = await api.get('/api/v1/lifecycle');
    const initialBody = await initial.json();

    expect(initialBody.phase).toBe('FT2');

    // ─────────────────────────────────────────────
    // 2. Hard refresh the UI
    // ─────────────────────────────────────────────
    await page.goto('/');
    await page.reload();

    // UI must NOT show FT1 affordances
    await expect(
      page.getByRole('button', { name: /unlock insights/i })
    ).not.toBeVisible();

    // ─────────────────────────────────────────────
    // 3. Re-check backend lifecycle
    // ─────────────────────────────────────────────
    const afterRefresh = await api.get('/api/v1/lifecycle');
    const afterRefreshBody = await afterRefresh.json();

    expect(afterRefreshBody.phase).toBe('FT2');

    // ─────────────────────────────────────────────
    // 4. Re-confirm FT1 (must be ignored)
    // ─────────────────────────────────────────────
    const ft1Confirm = await api.post('/api/v1/lifecycle/ft1/confirm');
    expect(ft1Confirm.ok()).toBeTruthy();

    const afterIllegalAttempt = await api.get('/api/v1/lifecycle');
    const afterIllegalBody = await afterIllegalAttempt.json();

    expect(afterIllegalBody.phase).toBe('FT2');
  });
});
