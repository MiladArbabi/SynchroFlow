// tests/unit/ui/products/ProductsPage.adapter.test.tsx

import { mapProductsFt1Props } from 'pages/products/useProductsFt1Adapter';

describe('Products FT1 adapter', () => {
  it('returns null productCount when signal is missing', () => {
    const data = {
      modules: [
        { moduleId: 'sku-os', signals: [] }
      ],
    };

    expect(mapProductsFt1Props(data)).toEqual({
      productCount: null,
    });
  });

  it('returns null productCount when signal is undefined', () => {
    const data = {
      modules: [
        {
          moduleId: 'sku-os',
          signals: [{ name: 'skuOs.productCount', value: undefined }],
        },
      ],
    };

    expect(mapProductsFt1Props(data)).toEqual({
      productCount: null,
    });
  });

  it('returns numeric productCount when signal exists', () => {
    const data = {
      modules: [
        {
          moduleId: 'sku-os',
          signals: [{ name: 'skuOs.productCount', value: 7 }],
        },
      ],
    };

    expect(mapProductsFt1Props(data)).toEqual({
      productCount: 7,
    });
  });
});