// apps/frontend/src/api/members.ts
import { axiosInstance } from './axiosConfig';

/**
 * Update the current user's display currency and locale preference.
 * Persisted to shop_memberships.display_currency + locale.
 * Takes effect immediately via EntitlementsContext refresh.
 */
export async function updateCurrencyPreference(
  displayCurrency: string,
  locale: string
): Promise<void> {
  await axiosInstance.patch('/api/v1/members/me/currency', {
    displayCurrency,
    locale,
  });
}