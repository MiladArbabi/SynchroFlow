import {
  approachingFulfillmentSlaLeadSeconds,
  isApproachingFulfillmentSla,
} from '@lasyncro/shared/contracts/fulfillment-sla';

describe('SLA-SEM-01 canonical approaching Fulfillment SLA arithmetic', () => {
  it.each([
    [1, 15 * 60],
    [8, 2 * 3600],
    [24, 4 * 3600],
    [48, 4 * 3600],
    [720, 4 * 3600],
  ])(
    'SLA-APPROACH-03 uses min(4h, 25%% SLA) for %sh SLA',
    (slaHours, expectedLeadSeconds) => {
      expect(
        approachingFulfillmentSlaLeadSeconds(slaHours)
      ).toBe(expectedLeadSeconds);
    }
  );

  it('uses paid age only and ignores creation-age concepts', () => {
    expect(
      isApproachingFulfillmentSla({
        ageSincePaidSeconds: 2 * 3600,
        fulfillmentSlaHours: 24,
      })
    ).toBe(false);
  });

  it('includes the warning-floor boundary and excludes the breach boundary', () => {
    expect(
      isApproachingFulfillmentSla({
        ageSincePaidSeconds: 20 * 3600,
        fulfillmentSlaHours: 24,
      })
    ).toBe(true);

    expect(
      isApproachingFulfillmentSla({
        ageSincePaidSeconds: 24 * 3600,
        fulfillmentSlaHours: 24,
      })
    ).toBe(false);
  });

  it('excludes fulfilled and already-breached orders', () => {
    expect(
      isApproachingFulfillmentSla({
        ageSincePaidSeconds: 21 * 3600,
        fulfillmentSlaHours: 24,
        isFulfilled: true,
      })
    ).toBe(false);

    expect(
      isApproachingFulfillmentSla({
        ageSincePaidSeconds: 21 * 3600,
        fulfillmentSlaHours: 24,
        isBreached: true,
      })
    ).toBe(false);
  });
});
