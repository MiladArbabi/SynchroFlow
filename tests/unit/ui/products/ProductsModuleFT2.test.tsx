import { render, screen } from '@testing-library/react';
import { ProductsModuleFT2 } from '@lasyncro/products';
import type { ProductsModuleFT2Props } from '@lasyncro/products';

describe('ProductsModuleFT2 (FT2 observability)', () => {
  it('renders FT2 CNS surfaces deterministically', () => {
    const props: ProductsModuleFT2Props = {
      context: {
        period: { from: '2025-01-01', to: '2025-01-31' },
        productsObserved: 10,
      },
      outcome: { status: 'positive' }, // ignored by FT2 UI
      trend: { direction: 'unknown' }, // ignored by FT2 UI
      dataGaps: null,
      operationalRisk: null,
      economicBlindSpots: null,
    };

    render(<ProductsModuleFT2 {...props} />);

    // KPI / Data visibility
    expect(screen.getByText('Products detected')).toBeInTheDocument();

    // Data gaps
    expect(screen.getByText('Consistent product data')).toBeInTheDocument();
    expect(screen.getByText('Duplicate products')).toBeInTheDocument();
    expect(screen.getByText('Variant growth')).toBeInTheDocument();

    // Operational risk
    expect(screen.getByText('Stock visibility')).toBeInTheDocument();
    expect(screen.getByText('Sales exceed stock')).toBeInTheDocument();
    expect(screen.getByText('Change impact')).toBeInTheDocument();

    // Economic blind spots
    expect(screen.getByText('Cost coverage')).toBeInTheDocument();
    expect(screen.getByText('Price vs cost')).toBeInTheDocument();
    expect(screen.getByText('Revenue vs profit')).toBeInTheDocument();
  });

  it('renders null-safe FT2 surfaces without crashing', () => {
    const props: ProductsModuleFT2Props = {
      context: {
        period: { from: '', to: '' },
        productsObserved: null,
      },
      outcome: null,
      trend: null,
      dataGaps: null,
      operationalRisk: null,
      economicBlindSpots: null,
    };

    render(<ProductsModuleFT2 {...props} />);

    expect(screen.getByText('Products detected')).toBeInTheDocument();
  });
});