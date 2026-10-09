import type { Knex } from 'knex';
import { withTenant } from '../db.js';

export interface ShopifyAppInstallation {
  id?: number;
  shop_id: number;
  shop_domain: string;
  scopes: string;
  installed_at: Date;
  uninstalled_at?: Date;
  created_at?: Date;
  updated_at?: Date;
}

export class ShopifyAppService {
  /**
   * Create a new app installation record
   */
  static async createAppInstallation(installation: Omit<ShopifyAppInstallation, 'id' | 'created_at' | 'updated_at'>): Promise<ShopifyAppInstallation> {
    const [newInstallation] = await withTenant(installation.shop_id, (trx) =>
      trx('shopify_app_installations')
        .insert(installation)
        .returning('*')
    );

    return newInstallation;
  }

  /**
   * Get app installation by shop domain
   */
  static async getAppInstallation(
    shopDomain: string,
    shopId: number,
  ): Promise<ShopifyAppInstallation | null> {
    const installation = await withTenant(shopId, (trx) =>
      trx('shopify_app_installations')
        .where({ shop_id: shopId, shop_domain: shopDomain })
        .whereNull('uninstalled_at')
        .first()
    );

    return installation || null;
  }

  /** Destroy credential authority atomically inside the caller's tenant transaction. */
  static async hardFenceAppUninstalled(
    shopId: number,
    trx: Knex.Transaction,
    now: Date,
    shopDomain?: string,
  ): Promise<void> {
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), ?)',
      ['shopify_admin_credential_rotation', shopId]);

    const installationQuery = trx('shopify_app_installations').where({ shop_id: shopId });
    if (shopDomain !== undefined) installationQuery.where({ shop_domain: shopDomain });
    const installations = await installationQuery
      .update({ uninstalled_at: now, updated_at: now })
      .returning('id');
    if (installations.length === 0) return;

    // State equality does not imply epoch equality: even REAUTH_REQUIRED advances.
    await trx('shopify_admin_credentials')
      .where({ shop_id: shopId })
      .whereIn('installation_id', installations.map(installation => installation.id))
      .update({
        credential_generation: trx.raw('?? + 1', ['credential_generation']),
        credential_state: 'REAUTH_REQUIRED',
        access_token_encrypted: null,
        refresh_token_encrypted: null,
        access_expires_at: null,
        refresh_expires_at: null,
        rotation_lease_token: null,
        rotation_lease_expires_at: null,
        rotation_started_at: null,
        updated_at: now,
      });

    await trx('integrations')
      .where({ shop_id: shopId, platform: 'shopify' })
      .update({ updated_at: now });
  }

  /** Mark the exact installation uninstalled through the shared authority fence. */
  static async markAppUninstalled(shopDomain: string, shopId: number): Promise<void> {
    await withTenant(shopId, trx =>
      this.hardFenceAppUninstalled(shopId, trx, new Date(), shopDomain));
  }
  
  /**
   * @deprecated
   * Shopify returns webhooks are NOT reliable nor accessible
   * under current scopes. Refunds are authoritative instead.
   */
  static async registerReturnsRequestedWebhook(): Promise<void> {
    console.warn(
      '[DEPRECATED] registerReturnsRequestedWebhook skipped — refunds pipeline is authoritative',
    );
    return;
  }
}
