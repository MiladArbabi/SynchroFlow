// tests/unit/backend/wms/shippo-provider-carrier-account-1114.test.ts
//
// #1114 — Carrier tracking reconciliation, Shippo metadata contract.
//
// WORKSHOP #1114 (Shippo metadata strategy, "persist both"): a successful
// label purchase must capture the provider-authoritative `rate.carrier_account`
// from the PURCHASED rate — the only reconciliation metadata genuinely
// available synchronously, at zero extra Shippo API cost, during the
// existing label-purchase flow — WITHOUT depending on resolving the
// canonical carrier token (that is a separate, later, best-effort step;
// see WORKSHOP #1114 §5 — label purchase must never be reported as failed
// merely because that AUXILIARY lookup fails afterward).
//
// This exercises the REAL, EXISTING ShippoCarrierService.generateLabel()
// seam (no future interface, no future module) with `fetch` mocked at the
// same boundary the real implementation calls. It is expected to fail by
// assertion today: GenerateLabelResult carries no field for the purchased
// rate's carrier_account at all yet.
//
// Per the RED-authoring brief: TypeScript must not be worked around by
// widening GenerateLabelResult ahead of implementation, so the assertion
// below reads the future field via a narrow runtime property access
// (`Record<string, unknown>` cast), not a new interface.

import { shippoCarrierService } from 'api-src/services/wms/carriers/shippo.carrier.service';
import type { GenerateLabelInput, CarrierCredentials } from 'api-src/services/wms/carriers/ICarrierProvider';

const CREDENTIALS: CarrierCredentials = {
  apiToken: 'shippo-test-token-1114',
  publicKey: null,
  privateKey: null,
};

const INPUT: GenerateLabelInput = {
  shopId: 1,
  lasyncroOrderId: '11111111-1111-1111-1111-111111111111',
  pickBatchId: null,
  recipientName: 'Test Recipient',
  recipientPhone: '+15555550100',
  recipientState: 'CA',
  address1: '123 Test St',
  address2: null,
  city: 'Testville',
  postalCode: '90210',
  countryCode: 'US',
  weightGrams: 500,
  orderNumber: 'TEST-1114',
  senderAddress: {
    name: 'Sender Co',
    street1: '1 Sender Way',
    street2: null,
    city: 'Senderton',
    state: 'NY',
    postalCode: '10001',
    countryCode: 'US',
    phone: '+15555550101',
    email: 'sender@example.com',
  },
};

function mockFetchSequence() {
  const shipmentResponse = {
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
  };

  const transactionResponse = {
    status: 'SUCCESS',
    tracking_number: '9400111899223197428490',
    tracking_url_provider: 'https://tools.usps.com/track/9400111899223197428490',
    label_url: 'https://shippo-delivery.s3.amazonaws.com/fixture-label.pdf',
  };

  return jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => shipmentResponse })
    .mockResolvedValueOnce({ ok: true, json: async () => transactionResponse });
}

describe('#1114 Shippo label purchase — provider-authoritative carrier_account capture', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('exposes the purchased rate\'s carrier_account as providerCarrierAccountId on the label result', async () => {
    global.fetch = mockFetchSequence() as unknown as typeof global.fetch;

    const result = await shippoCarrierService.generateLabel(INPUT, CREDENTIALS);

    // Sanity: the existing, already-working label-purchase contract is intact.
    expect(result.trackingNumber).toBe('9400111899223197428490');
    expect(result.carrierCode).toBe('shippo');

    // RED: GenerateLabelResult does not carry this field yet. Narrow runtime
    // access only — no future interface/type is introduced to make this compile.
    const resultRecord = result as unknown as Record<string, unknown>;
    expect(resultRecord.providerCarrierAccountId).toBe('ca_fixture_1114');

    // This contract does NOT require the canonical carrier token
    // (providerCarrierCode) to exist at label-purchase time — that is a
    // separate, later, best-effort resolution step (see #1114 workshop §5).
    // No assertion on providerCarrierCode is made here by design.
  });
});
