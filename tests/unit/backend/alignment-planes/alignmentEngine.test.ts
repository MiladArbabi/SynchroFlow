import { executeAlignmentPlanes } from
  'api-src/services/alignment-planes/engine';
import type { AlignmentPlane, AlignmentResult } from
  'api-src/services/alignment-planes/alignmentPlane.types';

describe('Alignment Plane Engine — executeAlignmentPlanes', () => {
  const makePlane = (
    id: string,
    result: AlignmentResult
  ): AlignmentPlane<any> & { compute: jest.Mock } => ({
    id,
    compute: jest.fn(() => result),
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('short-circuits all planes when META is not aligned', () => {
    const planeA = makePlane('plane-a', 'aligned');
    const planeB = makePlane('plane-b', 'divergent');

    const output = executeAlignmentPlanes(
      { visibilities: ['sufficient', null] }, // META → unknown
      [
        { plane: planeA, input: {} },
        { plane: planeB, input: {} },
      ]
    );

    expect(output['cross-domain-trust']).toBe('unknown');
    expect(output['plane-a']).toBe('unknown');
    expect(output['plane-b']).toBe('unknown');

    expect(planeA.compute).not.toHaveBeenCalled();
    expect(planeB.compute).not.toHaveBeenCalled();
  });

  it('short-circuits all planes when visibility gate fails', () => {
    const planeA = makePlane('plane-a', 'aligned');

    const output = executeAlignmentPlanes(
      { visibilities: ['sufficient', 'insufficient'] }, // META → divergent OR visibility fail
      [{ plane: planeA, input: {} }]
    );

    expect(output['cross-domain-trust']).not.toBe('aligned');
    expect(output['plane-a']).toBe('unknown');
    expect(planeA.compute).not.toHaveBeenCalled();
  });

  it('executes planes when META aligned and visibility sufficient', () => {
    const planeA = makePlane('plane-a', 'aligned');
    const planeB = makePlane('plane-b', 'divergent');

    const output = executeAlignmentPlanes(
      { visibilities: ['sufficient', 'sufficient'] },
      [
        { plane: planeA, input: { a: 1 } },
        { plane: planeB, input: { b: 2 } },
      ]
    );

    expect(output['cross-domain-trust']).toBe('aligned');
    expect(output['plane-a']).toBe('aligned');
    expect(output['plane-b']).toBe('divergent');

    expect(planeA.compute).toHaveBeenCalledTimes(1);
    expect(planeB.compute).toHaveBeenCalledTimes(1);
  });

  it('is deterministic for identical inputs', () => {
    const planeA = makePlane('plane-a', 'aligned');

    const inputMeta = { visibilities: ['sufficient'] as Array<'sufficient'> };
    const planes = [{ plane: planeA, input: { x: 1 } }];

    const out1 = executeAlignmentPlanes(inputMeta, planes);
    const out2 = executeAlignmentPlanes(inputMeta, planes);

    expect(out1).toEqual(out2);
  });

  it('keys results strictly by plane.id without mutation', () => {
    const planeA = makePlane('plane-a', 'aligned');

    const output = executeAlignmentPlanes(
      { visibilities: ['sufficient'] },
      [{ plane: planeA, input: {} }]
    );

    expect(Object.keys(output)).toContain('plane-a');
    expect(planeA.id).toBe('plane-a');
  });
});