import { withTenant } from '@lasyncro/backend-core/db.js';
import { persistShopifyAdminCredentials } from
  'api-src/services/shopify/shopifyAdminCredential.repository';
import { SHOPIFY_REQUIRED_SCOPE_STRING } from
  'api-src/services/shopify/shopifyScopes';
import type { ShopifySyncExecutionAuthority } from
  'api-src/services/shopify/shopifyIntegrationStatus.service';

/** Disposable-DB-only fixture; never contact the Shopify provider. */
export async function seedOfflineShopifySyncAuthority(
  shopId: number,
  shopDomain: string
): Promise<ShopifySyncExecutionAuthority> {
  process.env.ENCRYPTION_KEY ||= 'offline-lifecycle-fixture-encryption-key-2026';

  return withTenant(shopId, async trx => {
    const [installation] = await trx('shopify_app_installations')
      .insert({
        shop_id: shopId,
        shop_domain: shopDomain,
        shop_gid: `gid://shopify/Shop/${shopId}`,
        scopes: SHOPIFY_REQUIRED_SCOPE_STRING,
        uninstalled_at: null,
      })
      .returning('id');

    const now = Date.now();

    await persistShopifyAdminCredentials(
      trx, Number(installation.id), shopId, {
        accessToken: 'test-token',
        refreshToken: 'test-refresh-token',
        accessExpiresAt: new Date(now + 86400000),
        refreshExpiresAt: new Date(now + 604800000),
        grantedScopes: SHOPIFY_REQUIRED_SCOPE_STRING,
      }
    );

    const credential = await trx('shopify_admin_credentials')
      .where({
        shop_id: shopId,
        installation_id: installation.id,
      })
      .first('credential_generation', 'credential_state');

    if (credential?.credential_state !== 'ACTIVE') {
      throw new Error('OFFLINE_SYNC_AUTHORITY_NOT_ACTIVE');
    }

    return {
      installationId: Number(installation.id),
      shopDomain,
      generation: String(credential.credential_generation),
    };
  });
}
