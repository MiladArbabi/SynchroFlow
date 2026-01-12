import { request } from '@playwright/test';

export async function createAuthenticatedApiContext() {
  const ctx = await request.newContext({
    baseURL: 'http://localhost:3000',
  });

  const res = await ctx.post('/api/v1/auth/test/issue-token', {
    data: { email: 'test@example.com' },
  });

  if (!res.ok()) {
    throw new Error(`Test token issuance failed: ${await res.text()}`);
  }

  const { accessToken } = await res.json();

  return request.newContext({
    baseURL: 'http://localhost:3000',
    extraHTTPHeaders: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}