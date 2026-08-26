import {
  selectAllRecountBins,
  toggleRecountBinSelection,
} from '../../../modules/wms/src/ui/pages/recountSelection';

describe('RECOUNT-CTA-33b recount bin selection', () => {
  const bins = [
    {
      location_code: 'A-1',
      reason: 'negative_on_hand',
      variant_count: 1,
      units: -2,
    },
    {
      location_code: 'A-2',
      reason: 'dormant',
      variant_count: 2,
      units: 8,
    },
    {
      location_code: 'B-1',
      reason: 'unlocated_sale',
      variant_count: 1,
      units: 3,
    },
  ];

  it('toggles bins independently without replacing the existing selection', () => {
    expect(toggleRecountBinSelection([], 'A-1')).toEqual(['A-1']);

    expect(
      toggleRecountBinSelection(['A-1'], 'A-2')
    ).toEqual(['A-1', 'A-2']);

    expect(
      toggleRecountBinSelection(['A-1', 'A-2'], 'A-1')
    ).toEqual(['A-2']);
  });

  it('selects every suggested bin without creating any task-side payload itself', () => {
    expect(selectAllRecountBins(bins)).toEqual(['A-1', 'A-2', 'B-1']);
  });

  it('deduplicates preview location codes defensively', () => {
    expect(selectAllRecountBins([...bins, bins[0]])).toEqual([
      'A-1',
      'A-2',
      'B-1',
    ]);
  });
});
