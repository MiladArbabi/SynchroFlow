// tests/unit/helpers/seedIntegration.ts

import db from 'api-db';

type SeedIntegrationInput = {
  shopId: number;
  platform?: string;
  syncStatus?: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
};

export async function seedIntegration({
  shopId,
  platform = 'shopify',
  syncStatus = 'COMPLETED',
}: SeedIntegrationInput) {
  await db('integrations').insert({
    shop_id: shopId,
    platform,
    sync_status: syncStatus,
    access_token_encrypted: 'test-encrypted-token',
  });
}