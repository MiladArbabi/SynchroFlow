// tests/integration/onboarding/readiness-wms-carrier-setup.test.ts
//
// Ops Console SETUP — "Connect your shipping carrier"
//
// wmsOnboardingSignalProvider.getSignals() must eventually emit:
//   { name: 'wms.carrierConfigured', value: <boolean> }
//
// Canonical truth: carrierConfigured = true only when the shop has at
// least one ACTIVE SUPPORTED carrier configuration with its required
// credential material —
//   Sendcloud: carrier_code='sendcloud', is_active=true, public_key AND
//   private_key both non-null.
//   Shippo:    carrier_code='shippo',    is_active=true, api_token non-null.
//
// This suite permanently protects the canonical carrier-configuration
// readiness contract across supported, inactive, incomplete, and valid
// carrier configurations.
//
// Fixture architecture follows tests/integration/wms/carrier-credentials-1114.test.ts:
// real Postgres, systemTransaction + createTenantShop + setTenantContext for
// tenant bootstrap, withTenant for shop_carrier_settings rows, unique
// per-test shops so no cross-test cleanup is required.
//
// wmsOnboardingSignalProvider.getSignals() reads through the guarded `db`
// singleton directly (no trx argument), which resolves its tenant from
// AsyncLocalStorage rather than from a passed connection. runWithTenantContext
// is the canonical wrapper for exercising such a caller under test — see
// tests/integration/wms/release-readiness.test.ts and the other
// runWithTenantContext(shopId, () => processDomainEvent(...)) call sites.

import crypto from 'crypto';
import db, { withTenant, setTenantContext, systemTransaction, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { encrypt } from 'api-src/security/encryption.service';
import { wmsOnboardingSignalProvider } from 'api-src/onboarding/readiness.providers';

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
  carrierCode: string,
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

async function carrierConfiguredSignal(shopId: number) {
  const signals = await runWithTenantContext(shopId, () =>
    wmsOnboardingSignalProvider.getSignals({ shopId })
  );
  return signals.find((signal) => signal.name === 'wms.carrierConfigured');
}

describe('WMS onboarding readiness — wms.carrierConfigured', () => {
  it('reports incomplete when no carrier configuration exists', async () => {
    const shopId = await createShop('carriersetup-none');

    expect(await carrierConfiguredSignal(shopId)).toEqual({
      name: 'wms.carrierConfigured',
      value: false,
    });
  });

  it('reports incomplete when a supported carrier configuration is inactive', async () => {
    const shopId = await createShop('carriersetup-inactive');
    await seedCarrierSettings(
      shopId,
      'sendcloud',
      { publicKey: 'sendcloud-pub', privateKey: 'sendcloud-priv' },
      false
    );

    expect(await carrierConfiguredSignal(shopId)).toEqual({
      name: 'wms.carrierConfigured',
      value: false,
    });
  });

  it('reports incomplete when only an unsupported carrier is active', async () => {
    const shopId = await createShop('carriersetup-unsupported');
    await seedCarrierSettings(shopId, 'unsupported-carrier', { apiToken: 'unsupported-token' }, true);

    expect(await carrierConfiguredSignal(shopId)).toEqual({
      name: 'wms.carrierConfigured',
      value: false,
    });
  });

  it('reports incomplete when the active Sendcloud row is missing required credential material', async () => {
    const missingPrivateKeyShop = await createShop('carriersetup-sc-nopriv');
    await seedCarrierSettings(missingPrivateKeyShop, 'sendcloud', { publicKey: 'sendcloud-pub-only' }, true);

    expect(await carrierConfiguredSignal(missingPrivateKeyShop)).toEqual({
      name: 'wms.carrierConfigured',
      value: false,
    });

    const missingBothShop = await createShop('carriersetup-sc-nocreds');
    await seedCarrierSettings(missingBothShop, 'sendcloud', {}, true);

    expect(await carrierConfiguredSignal(missingBothShop)).toEqual({
      name: 'wms.carrierConfigured',
      value: false,
    });
  });

  it('reports incomplete when the active Shippo row is missing api_token', async () => {
    const shopId = await createShop('carriersetup-shippo-notoken');
    await seedCarrierSettings(shopId, 'shippo', {}, true);

    expect(await carrierConfiguredSignal(shopId)).toEqual({
      name: 'wms.carrierConfigured',
      value: false,
    });
  });

  it('reports complete for a valid active Sendcloud configuration', async () => {
    const shopId = await createShop('carriersetup-sc-valid');
    await seedCarrierSettings(
      shopId,
      'sendcloud',
      { publicKey: 'sendcloud-pub-valid', privateKey: 'sendcloud-priv-valid' },
      true
    );

    expect(await carrierConfiguredSignal(shopId)).toEqual({
      name: 'wms.carrierConfigured',
      value: true,
    });
  });

  it('reports complete for a valid active Shippo configuration', async () => {
    const shopId = await createShop('carriersetup-shippo-valid');
    await seedCarrierSettings(shopId, 'shippo', { apiToken: 'shippo-token-valid' }, true);

    expect(await carrierConfiguredSignal(shopId)).toEqual({
      name: 'wms.carrierConfigured',
      value: true,
    });
  });
});
