import { crossDomainTrustPlane } from
  'api-src/services/alignment-planes/crossDomainTrust.plane';

describe('Cross-Domain Trust Plane (META)', () => {
  it('returns unknown if any visibility is null', () => {
    const result = crossDomainTrustPlane.compute({
      visibilities: ['sufficient', null],
    });

    expect(result).toBe('unknown');
  });

  it('returns aligned when all visibilities are sufficient', () => {
    const result = crossDomainTrustPlane.compute({
      visibilities: ['sufficient', 'sufficient'],
    });

    expect(result).toBe('aligned');
  });

  it('returns unknown when all visibilities are insufficient', () => {
    const result = crossDomainTrustPlane.compute({
      visibilities: ['insufficient', 'insufficient'],
    });

    expect(result).toBe('unknown');
  });

  it('returns divergent when visibilities are mixed', () => {
    const result = crossDomainTrustPlane.compute({
      visibilities: ['sufficient', 'insufficient'],
    });

    expect(result).toBe('divergent');
  });

  it('returns unknown for empty visibility list', () => {
    const result = crossDomainTrustPlane.compute({
      visibilities: [],
    });

    expect(result).toBe('unknown');
  });
});