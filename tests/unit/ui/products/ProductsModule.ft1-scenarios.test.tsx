// tests/unit/ui/products/ProductsModule.ft1-scenarios.test.tsx

import { render, screen } from '@testing-library/react';
import ProductsModule, {
  useProductsFt1Scenario,
} from '@lasyncro/products';

jest.mock('@lasyncro/products', () => {
  const actual = jest.requireActual('@lasyncro/products');
  return {
    __esModule: true,
    ...actual,
    useProductsFt1Scenario: jest.fn(),
  };
});

describe('ProductsModule – FT1 scenario composition (diagnostic)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders LOADING diagnostic surface', () => {
    (useProductsFt1Scenario as jest.Mock).mockReturnValue('LOADING');

    render(<ProductsModule productCount={null} />);

    expect(
      screen.getByTestId('products-ft1-loading')
    ).toBeInTheDocument();
  });

  it('renders NO_PRODUCTS diagnostic surface', () => {
    (useProductsFt1Scenario as jest.Mock).mockReturnValue('NO_PRODUCTS');

    render(<ProductsModule productCount={0} />);

    expect(
      screen.getByTestId('products-ft1-no-products')
    ).toBeInTheDocument();

    expect(
      screen.getByText(/We haven’t detected any products for this store/i)
    ).toBeInTheDocument();
  });

  it('renders HEALTHY diagnostic surface', () => {
    (useProductsFt1Scenario as jest.Mock).mockReturnValue('HEALTHY');

    render(<ProductsModule productCount={12} />);

    expect(
      screen.getByTestId('products-ft1-healthy')
    ).toBeInTheDocument();
  });
});
