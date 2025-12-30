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
          signals: [{ name: 'sku-os.productCount', value: undefined }],
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
          signals: [{ name: 'sku-os.productCount', value: 7 }],
        },
      ],
    };

    expect(mapProductsFt1Props(data)).toEqual({
      productCount: 7,
    });
  });

  it('returns 0 when productsKnown=true and productCount=0', () => {
    const data = {
      modules: [
        {
          moduleId: 'sku-os',
          signals: [
            { name: 'sku-os.productsKnown', value: true },
            { name: 'sku-os.productCount', value: 0 },
          ],
        },
      ],
    };

    expect(mapProductsFt1Props(data)).toEqual({
      productCount: 0,
    });
  });

  it('returns null when productsKnown=false even if productCount is present', () => {
    const data = {
      modules: [
        {
          moduleId: 'sku-os',
          signals: [
            { name: 'sku-os.productsKnown', value: false },
            { name: 'sku-os.productCount', value: 5 },
          ],
        },
      ],
    };

    expect(mapProductsFt1Props(data)).toEqual({
      productCount: null,
    });
  });
});