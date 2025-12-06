// apps/frontend/src/api/onboarding.ts

import type { OnboardingReadinessSnapshot } from '@lasyncro/shared';

type FetchOnboardingReadinessOpts = {
  shopId?: number;
  accessToken?: string;
};

/**
 * Fetches the onboarding readiness snapshot from the backend.
 *
 * - Uses the shared contract type from @lasyncro/shared
 * - Optionally accepts a shopId (mainly useful for local testing / curl parity)
 * - Optionally accepts an accessToken for authenticated calls
 */
export async function fetchOnboardingReadiness(
  opts?: FetchOnboardingReadinessOpts
): Promise<OnboardingReadinessSnapshot> {
  const params = new URLSearchParams();

  if (opts?.shopId != null) {
    params.set('shopId', String(opts.shopId));
  }

  const query = params.toString();
  const url = `/api/v1/onboarding/readiness${query ? `?${query}` : ''}`;

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (opts?.accessToken) {
    headers.Authorization = `Bearer ${opts.accessToken}`;
  }

  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include', // send cookies for authenticated calls
    headers,
  });

  if (!res.ok) {
    throw new Error(
      `Failed to fetch onboarding readiness: ${res.status} ${res.statusText}`
    );
  }

  return res.json() as Promise<OnboardingReadinessSnapshot>;
}
