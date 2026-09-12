import {
  rankSearchResults,
  SearchCandidate,
} from 'api-src/api/search/searchRanking';

function candidate(input: Partial<SearchCandidate> & Pick<SearchCandidate, 'type' | 'id' | 'label'>): SearchCandidate {
  return {
    secondary: null,
    meta: null,
    match: 'text',
    identifiers: [input.id],
    text: [input.label],
    ...input,
  };
}

describe('global search ranking', () => {
  it('exact identifier matches outrank prefix and text matches', () => {
    const results = rankSearchResults('ABC123', [
      candidate({ type: 'variant', id: 'text', label: 'Widget ABC123', identifiers: ['SKU-1'] }),
      candidate({ type: 'batch', id: 'prefix', label: 'ABC123-REST', identifiers: ['ABC123-REST'] }),
      candidate({ type: 'order', id: 'exact', label: 'ABC123', identifiers: ['ABC123'] }),
    ]);

    expect(results.map((result) => result.id)).toEqual(['exact', 'prefix', 'text']);
    expect(results.map((result) => result.match)).toEqual(['exact', 'prefix', 'text']);
  });

  it('"order" intent boosts orders without becoming mandatory syntax', () => {
    const candidates = [
      candidate({ type: 'variant', id: 'variant-42', label: 'Product 1042', identifiers: ['SKU-1042'] }),
      candidate({ type: 'order', id: 'order-42', label: '1042', identifiers: ['1042'] }),
    ];

    expect(rankSearchResults('order 1042', candidates)[0]).toMatchObject({
      type: 'order',
      id: 'order-42',
    });
    expect(rankSearchResults('1042', candidates).map((result) => result.id))
      .toContain('order-42');
  });

  it('normalizes deterministically and caps responses at 6', () => {
    const candidates = Array.from({ length: 8 }, (_, index) =>
      candidate({
        type: index % 2 === 0 ? 'order' : 'variant',
        id: `id-${index}`,
        label: `ABC-${index}`,
        identifiers: [`ABC-${index}`],
      })
    );

    const first = rankSearchResults('  #abc ', candidates);
    const second = rankSearchResults('#ABC', candidates);

    expect(first).toHaveLength(6);
    expect(second).toEqual(first);
  });
});
