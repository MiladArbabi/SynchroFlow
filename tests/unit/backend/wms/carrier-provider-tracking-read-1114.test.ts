import { shippoCarrierService } from '../../../../apps/backend/src/services/wms/carriers/shippo.carrier.service';
import { sendcloudCarrierService } from '../../../../apps/backend/src/services/wms/carriers/sendcloud.carrier.service';

interface TrackingReadInput {
  trackingNumber: string;
  providerCarrierCode?: string | null;
}

interface TrackingReadCredentials {
  publicKey: string | null;
  privateKey: string | null;
  apiToken: string | null;
}

interface TrackingReadResult {
  rawStatus: string;
  eventTimestamp: Date;
  location: string | null;
  rawPayload: unknown;
}

interface TrackingReadableProvider {
  getTracking?: (
    input: TrackingReadInput,
    credentials: TrackingReadCredentials
  ) => Promise<TrackingReadResult>;
}

function requireGetTracking(
  provider: unknown,
  providerName: string
): NonNullable<TrackingReadableProvider['getTracking']> {
  const method = (provider as TrackingReadableProvider).getTracking;

  expect(typeof method).toBe('function');

  if (typeof method !== 'function') {
    throw new Error(`${providerName}_GET_TRACKING_SEAM_MISSING`);
  }

  return method.bind(provider);
}

describe('#1114 provider tracking reads', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('ShippoCarrierService.getTracking', () => {
    const credentials: TrackingReadCredentials = {
      publicKey: null,
      privateKey: null,
      apiToken: 'shippo_test_1114',
    };

    it('reads the provider-authoritative latest tracking observation', async () => {
      const response = {
        carrier: 'usps',
        tracking_number: '9400111899223197428490',
        tracking_status: {
          status: 'DELIVERED',
          status_date: '2026-09-16T10:15:00.000Z',
          location: {
            city: 'Stockholm',
            state: 'AB',
            country: 'SE',
          },
        },
        tracking_history: [],
      };

      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => response,
      });

      global.fetch = fetchMock as unknown as typeof global.fetch;

      const getTracking = requireGetTracking(
        shippoCarrierService,
        'SHIPPO'
      );

      const result = await getTracking(
        {
          trackingNumber: '9400111899223197428490',
          providerCarrierCode: 'usps',
        },
        credentials
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, options] = fetchMock.mock.calls[0];

      expect(url).toBe(
        'https://api.goshippo.com/tracks/usps/9400111899223197428490'
      );

      expect(options).toEqual(
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'ShippoToken shippo_test_1114',
          }),
        })
      );

      expect(result.rawStatus).toBe('DELIVERED');
      expect(result.eventTimestamp).toEqual(
        new Date('2026-09-16T10:15:00.000Z')
      );
      expect(result.location).toBe('Stockholm, AB, SE');
      expect(result.rawPayload).toBe(response);
    });

    it('requires providerCarrierCode rather than guessing a Shippo carrier token', async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof global.fetch;

      const getTracking = requireGetTracking(
        shippoCarrierService,
        'SHIPPO'
      );

      await expect(
        getTracking(
          {
            trackingNumber: '9400111899223197428490',
            providerCarrierCode: null,
          },
          credentials
        )
      ).rejects.toThrow(/carrier/i);

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('SendcloudCarrierService.getTracking', () => {
    const credentials: TrackingReadCredentials = {
      publicKey: 'sendcloud_public_1114',
      privateKey: 'sendcloud_private_1114',
      apiToken: null,
    };

    it('reads Sendcloud v3 parent_status and the latest timeline timestamp', async () => {
      const response = {
        parent_status: 'Parcel en route',
        announced_at: '2026-09-16T08:00:00.000Z',
        created_at: '2026-09-16T07:55:00.000Z',
        events: [
          {
            event_at: '2026-09-16T08:30:00.000Z',
            event_type: 'carrier',
            status_code: 'accepted',
            status_description: 'Accepted by carrier',
          },
          {
            event_at: '2026-09-16T11:45:00.000Z',
            event_type: 'carrier',
            status_code: 'in_transit',
            status_description: 'Parcel en route',
          },
        ],
        tracking_numbers: [
          {
            carrier_code: 'postnl',
            tracking_number: 'SC-TRACK-1114',
          },
        ],
      };

      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => response,
      });

      global.fetch = fetchMock as unknown as typeof global.fetch;

      const getTracking = requireGetTracking(
        sendcloudCarrierService,
        'SENDCLOUD'
      );

      const result = await getTracking(
        {
          trackingNumber: 'SC-TRACK-1114',
        },
        credentials
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, options] = fetchMock.mock.calls[0];

      expect(url).toBe(
        'https://panel.sendcloud.sc/api/v3/parcels/tracking/SC-TRACK-1114'
      );

      expect(options).toEqual(
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization:
              'Basic ' +
              Buffer.from(
                'sendcloud_public_1114:sendcloud_private_1114'
              ).toString('base64'),
          }),
        })
      );

      expect(result.rawStatus).toBe('Parcel en route');
      expect(result.eventTimestamp).toEqual(
        new Date('2026-09-16T11:45:00.000Z')
      );

      // Sendcloud v3's documented tracking event does not expose a
      // shipment location field equivalent to Shippo tracking_status.location.
      expect(result.location).toBeNull();
      expect(result.rawPayload).toBe(response);
    });

    it('does not require a provider carrier token for Sendcloud tracking reads', async () => {
      const response = {
        parent_status: 'Delivered',
        events: [
          {
            event_at: '2026-09-16T12:00:00.000Z',
            event_type: 'carrier',
            status_code: 'delivered',
            status_description: 'Delivered',
          },
        ],
      };

      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => response,
      });

      global.fetch = fetchMock as unknown as typeof global.fetch;

      const getTracking = requireGetTracking(
        sendcloudCarrierService,
        'SENDCLOUD'
      );

      const result = await getTracking(
        {
          trackingNumber: 'SC-DELIVERED-1114',
          providerCarrierCode: null,
        },
        credentials
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.rawStatus).toBe('Delivered');
    });
  });
});
