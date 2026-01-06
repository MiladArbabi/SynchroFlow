// tests/unit/ui/products/ProductsModuleFT2.test.tsx

import { render, screen } from '@testing-library/react';
import { ProductsModuleFT2 } from '@lasyncro/products';
import type { ProductsModuleFT2Props } from '@lasyncro/products';

describe('ProductsModuleFT2', () => {
  it('renders with full data deterministically', () => {
    const props: ProductsModuleFT2Props = {
      context: {
        period: { from: '2025-01-01', to: '2025-01-31' },
        productsAnalyzed: 10,
      },
      productSummary: {
        totalRevenue: 1000,
        totalCost: 700,
        netContribution: 300,
        currency: 'USD',
      },
      productBreakdown: [
        {
          sku: 'SKU-1',
          revenue: 600,
          cost: 400,
          marginPct: 33,
        },
      ],
      dominantProductPressure: {
        sku: 'SKU-1',
        pressureType: 'low-margin',
        confidence: 'high',
      },
      timeSignal: {
        trend: 'stable',
      },
    };

    render(<ProductsModuleFT2 {...props} />);

    expect(screen.getByTestId('products-ft2-root')).toBeInTheDocument();

    const root = screen.getByTestId('products-ft2-root');

    expect(root).toHaveTextContent('Products analyzed');
    expect(root).toHaveTextContent('10');

    expect(root).toHaveTextContent('Total revenue');
    expect(root).toHaveTextContent('1000');

    expect(root).toHaveTextContent('SKU-1');
    expect(root).toHaveTextContent('stable');
  });

  it('renders nulls as em dashes', () => {
    const props: ProductsModuleFT2Props = {
      context: {
        period: { from: '', to: '' },
        productsAnalyzed: null,
      },
      productSummary: {
        totalRevenue: null,
        totalCost: null,
        netContribution: null,
        currency: null,
      },
      productBreakdown: null,
      dominantProductPressure: null,
      timeSignal: null,
    };

    render(<ProductsModuleFT2 {...props} />);

    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});