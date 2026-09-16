// tests/integration/wms/carrier-credentials-1114.test.ts
//
// #1114 STEP 5B — shared carrier credential resolution, RED.
//
// Ratified seam (not yet built):
//   resolveCarrierCredentials(trx, shopId, carrierCode): Promise<CarrierCredentials>
//
// shop_carrier_settings' primary key is (shop_id, carrier_code) and a shop
// may legitimately have MORE THAN ONE active carrier row at once (e.g.
// Shippo AND Sendcloud both configured). The resolver MUST query the exact
// requested (shop_id, carrier_code, is_active=true) tuple — never an
// arbitrary "first active carrier" for the shop. Real Postgres is the
// honest layer here: the whole point under test is a WHERE-clause
// selectivity guarantee across multiple real rows, which a fake/mock
// transaction cannot meaningfully prove.
//
// Credential decryption must preserve the EXISTING double-JSON storage
// contract exactly (decrypt(JSON.parse(settings.public_key),
// `wms.carrier.${carrierCode}`) — see carrierLabel.service.ts) — this test
// seeds fixtures the same way the real controller writes them
// (wms.controller.ts: `JSON.stringify(encrypt(secret))`), never
// hand-crafted ciphertext.
//
// RED today: no `resolveCarrierCredentials` module/function exists yet.
// The dynamic import below is deliberate — a controlled, assertion-visible
// failure inside a running test (matching the existing
// tests/unit/backend/wms/carrier-provider-tracking-read-1114.test.ts
// `requireGetTracking` convention) rather than a suite-collection-level
// module-resolution crash.

import crypto from 'crypto';
import { withTenant, setTenantContext, systemTransaction } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { encrypt } from 'api-src/security/encryption.service';

async function createShop(prefix: string): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${prefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

/** Matches wms.controller.ts's exact persisted shape: JSON.stringify(encrypt(secret)). */
function encryptedField(secret: string): string {
  return JSON.stringify(encrypt(secret));
}

async function seedCarrierSettings(
  shopId: number,
  carrierCode: 'shippo' | 'sendcloud',
  fields: { publicKey?: string; privateKey?: string; apiToken?: string },
  isActive = true
): Promise<void> {
  await withTenant(shopId, (trx) =>
    trx('shop_carrier_settings').insert({
      shop_id: shopId,
      carrier_code: carrierCode,
      public_key: fields.publicKey ? encryptedField(fields.publicKey) : null,
      private_key: fields.privateKey ? encryptedField(fields.privateKey) : null,
      api_token: fields.apiToken ? encryptedField(fields.apiToken) : null,
      is_active: isActive,
    })
  );
}

/** Dynamic import so a missing module fails cleanly inside the test, not at suite collection. */
async function importResolveCarrierCredentials(): Promise<
  (trx: unknown, shopId: number, carrierCode: string) => Promise<{ publicKey: string | null; privateKey: string | null; apiToken: string | null }>
> {
  try {
    const mod: any = await import('api-src/services/wms/carriers/carrierCredentials.service');
    if (typeof mod.resolveCarrierCredentials !== 'function') {
      throw new Error('resolveCarrierCredentials export missing from carrierCredentials.service');
    }
    return mod.resolveCarrierCredentials;
  } catch (err) {
    throw new Error(
      `[CARRIER_CREDENTIALS_RESOLVER_SEAM_MISSING] resolveCarrierCredentials does not exist yet: ${(err as Error).message}`
    );
  }
}

describe('#1114 resolveCarrierCredentials — exact (shop_id, carrier_code) selectivity', () => {
  it('resolves the EXACT requested carrier when multiple carriers are active for the same shop', async () => {
    const shopId = await createShop('carriercred1114a');
    await seedCarrierSettings(shopId, 'shippo', { apiToken: 'shippo-secret-1114' });
    await seedCarrierSettings(shopId, 'sendcloud', { publicKey: 'sendcloud-pub-1114', privateKey: 'sendcloud-priv-1114' });

    const resolveCarrierCredentials = await importResolveCarrierCredentials();

    const shippoCreds = await withTenant(shopId, (trx) => resolveCarrierCredentials(trx, shopId, 'shippo'));
    expect(shippoCreds.apiToken).toBe('shippo-secret-1114');
    expect(shippoCreds.publicKey).toBeNull();
    expect(shippoCreds.privateKey).toBeNull();

    const sendcloudCreds = await withTenant(shopId, (trx) => resolveCarrierCredentials(trx, shopId, 'sendcloud'));
    expect(sendcloudCreds.publicKey).toBe('sendcloud-pub-1114');
    expect(sendcloudCreds.privateKey).toBe('sendcloud-priv-1114');
    expect(sendcloudCreds.apiToken).toBeNull();
  });

  it('never falls back to a different active carrier when the requested one is inactive', async () => {
    const shopId = await createShop('carriercred1114b');
    await seedCarrierSettings(shopId, 'shippo', { apiToken: 'shippo-secret-inactive-1114' }, false);
    await seedCarrierSettings(shopId, 'sendcloud', { publicKey: 'sendcloud-pub-other-1114', privateKey: 'sendcloud-priv-other-1114' }, true);

    const resolveCarrierCredentials = await importResolveCarrierCredentials();

    // Requesting the INACTIVE 'shippo' row must not silently resolve
    // 'sendcloud''s active credentials instead — an "arbitrary first active
    // carrier" implementation would fail this exact case.
    await expect(withTenant(shopId, (trx) => resolveCarrierCredentials(trx, shopId, 'shippo'))).rejects.toThrow();
  });
});
