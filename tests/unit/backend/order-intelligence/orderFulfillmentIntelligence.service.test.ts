import { deriveOrderFulfillmentIntelligence } from
  'api-src/services/order-intelligence/orderFulfillmentIntelligence.service';

describe('Fulfillment Intelligence — Epistemic Classification', () => {
  it('fails closed when visibility is null', () => {
    const result = deriveOrderFulfillmentIntelligence({
      fulfillmentSignal: 'present',
      visibility: null,
    });

    expect(result.operationalReality).toBe('unknown');
    expect(result.visibility).toBe('unknown');
  });

  it('fails closed when visibility is insufficient', () => {
    const result = deriveOrderFulfillmentIntelligence({
      fulfillmentSignal: 'present',
      visibility: 'insufficient',
    });

    expect(result.operationalReality).toBe('unknown');
    expect(result.visibility).toBe('unknown');
  });

  it('classifies operational reality when visibility is sufficient', () => {
    const real = deriveOrderFulfillmentIntelligence({
      fulfillmentSignal: 'present',
      visibility: 'sufficient',
    });

    expect(real.operationalReality).toBe('real');
    expect(real.visibility).toBe('sufficient');

    const unreal = deriveOrderFulfillmentIntelligence({
      fulfillmentSignal: 'absent',
      visibility: 'sufficient',
    });

    expect(unreal.operationalReality).toBe('unreal');
    expect(unreal.visibility).toBe('sufficient');
  });

  it('returns unknown when fulfillment signal is null', () => {
    const result = deriveOrderFulfillmentIntelligence({
      fulfillmentSignal: null,
      visibility: 'sufficient',
    });

    expect(result.operationalReality).toBe('unknown');
    expect(result.visibility).toBe('unknown');
  });

  it('is deterministic for identical inputs', () => {
    const input = {
      fulfillmentSignal: 'present' as const,
      visibility: 'sufficient' as const,
    };

    const out1 = deriveOrderFulfillmentIntelligence(input);
    const out2 = deriveOrderFulfillmentIntelligence(input);

    expect(out1).toEqual(out2);
  });
});