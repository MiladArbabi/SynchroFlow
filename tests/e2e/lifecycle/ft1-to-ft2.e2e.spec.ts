import { test, expect } from '@playwright/test';
import { createAuthenticatedApiContext } from '../utils/api-auth';

/**
 * INVARIANT TEST
 * --------------
 * FT2 must be reachable from FT1 via a SINGLE explicit user action,
 * without refresh, and with backend lifecycle as the sole authority.
 */
test.describe('Lifecycle invariant — FT1 → FT2 without refresh', () => {
  test('Unlock Insights promotes user to FT2 immediately', async ({ page }) => {
    // ─────────────────────────────────────────────
    // 1. Backend authority (API context)
    // ─────────────────────────────────────────────
    const api = await createAuthenticatedApiContext();

    const lifecycleBefore = await api.get('/api/v1/lifecycle');
    const lifecycleBeforeBody = await lifecycleBefore.json();

    expect(['FT1', 'FT2']).toContain(lifecycleBeforeBody.phase);

    if (lifecycleBeforeBody.phase === 'FT2') {
      test.skip(true, 'Already in FT2; invariant already satisfied');
    }

    // ─────────────────────────────────────────────
    // 2. UI surface (browser)
    // ─────────────────────────────────────────────
    await page.goto('/');

    const unlockButton = page.getByRole('button', {
      name: /unlock insights/i,
    });

    await expect(unlockButton).toBeVisible();

    // ─────────────────────────────────────────────
    // 3. Single user action
    // ─────────────────────────────────────────────
    await unlockButton.click();

    // ─────────────────────────────────────────────
    // 4. FT2 UI must appear WITHOUT refresh
    // ─────────────────────────────────────────────
    await expect(
      page.getByText(/insights/i)
    ).toBeVisible();

    await expect(
      page.getByText(/onboarding/i)
    ).not.toBeVisible();

    // ─────────────────────────────────────────────
    // 5. Backend lifecycle must now be FT2
    // ─────────────────────────────────────────────
    const lifecycleAfter = await api.get('/api/v1/lifecycle');
    const lifecycleAfterBody = await lifecycleAfter.json();

    expect(lifecycleAfterBody.phase).toBe('FT2');
  });
});