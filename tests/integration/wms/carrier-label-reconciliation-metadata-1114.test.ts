// tests/integration/wms/carrier-label-reconciliation-metadata-1114.test.ts
//
// #1114 STEP 5B — orchestration-level RED contracts for Shippo canonical
// carrier metadata, exercised through the REAL generateAndPersistLabel seam
// (real Postgres — the important behavior under test IS
// order_shipment_tracking persistence, which a mock-based unit test cannot
// honestly prove).
//
// C. A successful Shippo label purchase eventually persists BOTH
//    provider_carrier_account_id ('ca_fixture_1114', already implemented —
//    see shippo-provider-carrier-account-1114.test.ts) AND
//    provider_carrier_code ('usps', NOT yet implemented — this is the RED).
//
// D. When the auxiliary carrier-account lookup FAILS, the label purchase
//    must still succeed (generateAndPersistLabel resolves) and
//    provider_carrier_code must remain NULL — the failure must never
//    become a failed label operation. Today this is RED for a different
//    reason: the auxiliary lookup is never ATTEMPTED at all yet (there is
//    no third fetch call), so the specific "attempted-but-isolated" shape
//    this contract requires does not exist.
//
// E. No plaintext credential fixture value is ever written through
//    console.log/info/warn/error while generateAndPersistLabel resolves
//    credentials. This exercises the CURRENT real credential-resolution
//    code path (inline in generateAndPersistLabel today; will move into
//    resolveCarrierCredentials once STEP 5B's Section A lands, without
//    this contract needing to change). Expected GREEN today — a safety
//    characterization, not a gap.
//
// Fetch is mocked by URL dispatch (not fixed ordered .mockResolvedValueOnce
// calls) so this file stays a valid PERMANENT contract: it asserts the
// correct behavior both before and after the auxiliary-lookup
// implementation lands, without needing to be rewritten.

import crypto from 'crypto';
import { withTenant, setTenantContext, systemTransaction } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { encrypt } from 'api-src/security/encryption.service';
import { generateAndPersistLabel } from 'api-src/services/wms/carrierLabel.service';

const now = new Date('2026-09-16T12:00:00.000Z');

function encryptedField(secret: string): string {
  return JSON.stringify(encrypt(secret));
}

async function createShop(prefix: string): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${prefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

async function seedOrder(shopId: number): Promise<string> {
  const orderId = crypto.randomUUID();
  await withTenant(shopId, (trx) =>
    trx('orders').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      payment_state: 'paid',
      currency: 'USD',
      total_price: '100.00',
      subtotal_price: '100.00',
      total_tax: '0.00',
      order_created_at: now,
      order_updated_at: now,
      created_at: now,
      updated_at: now,
    })
  );
  return orderId;
}

async function seedShippoSettings(shopId: number, apiToken = 'shippo-secret-1114'): Promise<void> {
  await withTenant(shopId, (trx) =>
    trx('shop_carrier_settings').insert({
      shop_id: shopId,
      carrier_code: 'shippo',
      api_token: encryptedField(apiToken),
      is_active: true,
    })
  );
}

async function seedSenderAddress(shopId: number): Promise<void> {
  await withTenant(shopId, (trx) =>
    trx('shop_sender_addresses').insert({
      shop_id: shopId,
      name: 'Sender Co',
      street1: '1 Sender Way',
      city: 'Senderton',
      state: 'NY',
      postal_code: '10001',
      country_code: 'US',
      phone: '+15555550101',
      email: 'sender@example.com',
      is_default: true,
    })
  );
}

function baseLabelInput(shopId: number, orderId: string) {
  return {
    shopId,
    lasyncroOrderId: orderId,
    pickBatchId: null,
    orderNumber: 'TEST-1114',
    recipientName: 'Test Recipient',
    recipientPhone: '+15555550100',
    recipientState: 'CA',
    address1: '123 Test St',
    address2: null,
    city: 'Testville',
    postalCode: '90210',
    countryCode: 'US',
    weightGrams: 500,
  };
}

type CarrierAccountLookupMode = 'success' | 'failure';

/**
 * URL-dispatching fetch mock — matches whichever of the real Shippo calls
 * generateAndPersistLabel's dependency chain makes: POST /shipments/,
 * POST /transactions/, and (once implemented) GET /carrier_accounts/{id}.
 * Dispatch-by-URL (not ordered .mockResolvedValueOnce calls) keeps this a
 * valid permanent contract across the RED -> GREEN transition: today the
 * carrier_accounts branch is simply never reached.
 */
function mockShippoFetch(carrierAccountLookup: CarrierAccountLookupMode) {
  return jest.fn(async (url: string, options: { method?: string }) => {
    if (url.endsWith('/shipments/') && options.method === 'POST') {
      return {
        ok: true,
        json: async () => ({
          rates: [
            {
              object_id: 'rate_fixture_1114',
              amount: '5.00',
              currency: 'USD',
              provider: 'USPS',
              servicelevel: { name: 'Priority' },
              carrier_account: 'ca_fixture_1114',
            },
          ],
        }),
      };
    }

    if (url.endsWith('/transactions/') && options.method === 'POST') {
      return {
        ok: true,
        json: async () => ({
          status: 'SUCCESS',
          tracking_number: '9400111899223197428490',
          tracking_url_provider: 'https://tools.usps.com/track/9400111899223197428490',
          label_url: 'https://shippo-delivery.s3.amazonaws.com/fixture-label.pdf',
        }),
      };
    }

    if (url.includes('/carrier_accounts/') && options.method === 'GET') {
      if (carrierAccountLookup === 'success') {
        return { ok: true, json: async () => ({ object_id: 'ca_fixture_1114', carrier: 'usps' }) };
      }
      return { ok: false, status: 500, text: async () => 'carrier_accounts lookup failed (fixture)' };
    }

    throw new Error(`[CARRIER_LABEL_METADATA_TEST] Unexpected fetch URL/method: ${options.method} ${url}`);
  });
}

async function fetchShipmentRow(shopId: number, shipmentTrackingId: string) {
  return withTenant(shopId, (trx) => trx('order_shipment_tracking').where({ id: shipmentTrackingId }).first());
}

describe('#1114 label orchestration — Shippo canonical carrier metadata persistence', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // ── C ────────────────────────────────────────────────────────────────
  it('C: persists both provider_carrier_account_id and provider_carrier_code for a successful Shippo label purchase', async () => {
    const shopId = await createShop('carriermeta1114c');
    const orderId = await seedOrder(shopId);
    await seedShippoSettings(shopId);
    await seedSenderAddress(shopId);

    global.fetch = mockShippoFetch('success') as unknown as typeof global.fetch;

    const result = await withTenant(shopId, (trx) => generateAndPersistLabel(trx, baseLabelInput(shopId, orderId)));

    const row = await fetchShipmentRow(shopId, result.shipmentTrackingId);

    expect(row.provider_carrier_account_id).toBe('ca_fixture_1114');
    // RED: no auxiliary lookup exists yet, so this stays null today.
    expect(row.provider_carrier_code).toBe('usps');
  });

  // ── D ────────────────────────────────────────────────────────────────
  it('D: a failed auxiliary carrier-account lookup never fails the label purchase, and leaves provider_carrier_code null', async () => {
    const shopId = await createShop('carriermeta1114d');
    const orderId = await seedOrder(shopId);
    await seedShippoSettings(shopId);
    await seedSenderAddress(shopId);

    const fetchMock = mockShippoFetch('failure');
    global.fetch = fetchMock as unknown as typeof global.fetch;

    // The label purchase itself must still succeed — this is already true
    // today (trivially, since nothing attempts the lookup yet), and must
    // remain true once the auxiliary lookup exists and fails.
    const result = await withTenant(shopId, (trx) => generateAndPersistLabel(trx, baseLabelInput(shopId, orderId)));
    expect(result.shipmentTrackingId).toBeTruthy();

    // RED: the auxiliary lookup must be ATTEMPTED (a real GET
    // /carrier_accounts/{id} call, isolated from the purchase's success)
    // even though it fails. Today it is never attempted at all — only the
    // 2 label-purchase calls happen — so this fails with 2, not 3.
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const row = await fetchShipmentRow(shopId, result.shipmentTrackingId);
    expect(row.provider_carrier_account_id).toBe('ca_fixture_1114');
    expect(row.provider_carrier_code).toBeNull();
  });

  // ── E ────────────────────────────────────────────────────────────────
  it('E: no plaintext fixture credential is ever written through console.log/info/warn/error while credentials are resolved', async () => {
    const shopId = await createShop('carriermeta1114e');
    const orderId = await seedOrder(shopId);
    const plaintextSecret = 'shippo-secret-1114-do-not-leak';
    await seedShippoSettings(shopId, plaintextSecret);
    await seedSenderAddress(shopId);

    global.fetch = mockShippoFetch('success') as unknown as typeof global.fetch;

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await withTenant(shopId, (trx) => generateAndPersistLabel(trx, baseLabelInput(shopId, orderId)));

      const allLoggedArgs = [...logSpy.mock.calls, ...infoSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
        .flat()
        .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)));

      const leaked = allLoggedArgs.some((serialized) => serialized.includes(plaintextSecret));
      expect(leaked).toBe(false);
    } finally {
      logSpy.mockRestore();
      infoSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
