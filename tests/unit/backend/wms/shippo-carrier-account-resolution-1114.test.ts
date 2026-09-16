// tests/unit/backend/wms/shippo-carrier-account-resolution-1114.test.ts
//
// #1114 STEP 5B — Shippo canonical carrier token resolution, RED.
//
// WORKSHOP #1114 §5 (Shippo metadata strategy "persist both"): the
// purchased rate's carrier_account id (already captured as
// providerCarrierAccountId — see shippo-provider-carrier-account-1114.test.ts,
// GREEN) must be resolvable to the canonical Shippo carrier token
// (e.g. 'usps') via GET /carrier_accounts/{id}, so reconciliation's
// carrier-scoped tracking-read endpoint (GET /tracks/{carrier}/{tracking})
// can be called without ever guessing the token from carrier_zone/display
// text ("USPS") or any other heuristic.
//
// Follows the exact naming/placement precedent already established for
// ShippoCarrierService.getTracking (a method on the same class, guarded by
// a requireX-style existence check that fails cleanly via a Jest assertion
// rather than a raw TypeError or a suite-collection module-resolution
// crash) — see tests/unit/backend/wms/carrier-provider-tracking-read-1114.test.ts.
//
// RED today: no such method exists on ShippoCarrierService yet.

import { shippoCarrierService } from 'api-src/services/wms/carriers/shippo.carrier.service';

interface CarrierAccountResolutionCredentials {
  publicKey: string | null;
  privateKey: string | null;
  apiToken: string | null;
}

interface CarrierAccountResolvableProvider {
  resolveCarrierCodeFromAccount?: (
    providerCarrierAccountId: string,
    credentials: CarrierAccountResolutionCredentials
  ) => Promise<string>;
}

function requireResolveCarrierCodeFromAccount(
  provider: unknown
): NonNullable<CarrierAccountResolvableProvider['resolveCarrierCodeFromAccount']> {
  const method = (provider as CarrierAccountResolvableProvider).resolveCarrierCodeFromAccount;

  expect(typeof method).toBe('function');

  if (typeof method !== 'function') {
    throw new Error('SHIPPO_CARRIER_ACCOUNT_RESOLUTION_SEAM_MISSING');
  }

  return method.bind(provider);
}

describe('#1114 Shippo carrier_account -> canonical carrier token resolution', () => {
  const credentials: CarrierAccountResolutionCredentials = {
    publicKey: null,
    privateKey: null,
    apiToken: 'shippo_test_1114',
  };

  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('resolves the canonical carrier token from GET /carrier_accounts/{id}, never guessing from carrier_zone/display text', async () => {
    const response = {
      object_id: 'ca_fixture_1114',
      carrier: 'usps',
      // Deliberately includes a mismatched display-style field, so a
      // guessing implementation (parsing e.g. object_name/metadata) would
      // be caught reading the WRONG field.
      object_name: 'USPS Fixture Account',
    };

    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => response });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const resolveCarrierCodeFromAccount = requireResolveCarrierCodeFromAccount(shippoCarrierService);

    const token = await resolveCarrierCodeFromAccount('ca_fixture_1114', credentials);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];

    expect(url).toBe('https://api.goshippo.com/carrier_accounts/ca_fixture_1114');
    expect(options).toEqual(
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'ShippoToken shippo_test_1114' }),
      })
    );

    // Canonical result comes from the response's `carrier` field only —
    // never from object_name or any other display-text field.
    expect(token).toBe('usps');
    expect(token).not.toBe('USPS Fixture Account');
  });

  it('rejects rather than fabricating a token when the response has no carrier field', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ object_id: 'ca_fixture_1114', object_name: 'USPS Fixture Account' }),
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const resolveCarrierCodeFromAccount = requireResolveCarrierCodeFromAccount(shippoCarrierService);

    await expect(resolveCarrierCodeFromAccount('ca_fixture_1114', credentials)).rejects.toThrow();
  });
});
