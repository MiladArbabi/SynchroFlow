// apps/frontend/src/components/__tests__/CostStatusIndicator.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { CostStatusIndicator } from '../../../apps/frontend/src/components/CostStatusIndicator';

const mockProduct = {
  id: 1,
  platform_product_id: 'prod_123',
  title: 'Test Product',
};

describe('CostStatusIndicator', () => {
  const mockOnClick = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders add cost button when no cost data exists', () => {
    render(
      <CostStatusIndicator
        product={mockProduct}
        onClick={mockOnClick}
      />
    );

    expect(screen.getByRole('button')).toBeInTheDocument();
    expect(screen.getByTestId('AddIcon')).toBeInTheDocument();
  });

  it('calls onClick when button is clicked', () => {
    render(
      <CostStatusIndicator
        product={mockProduct}
        onClick={mockOnClick}
      />
    );

    const button = screen.getByRole('button');
    fireEvent.click(button);
    
    expect(mockOnClick).toHaveBeenCalledTimes(1);
  });

  it('displays margin percentage when product has cost data', () => {
    const productWithCost = {
      ...mockProduct,
      purchase_price: 10,
      landed_cost: 15,
      selling_price: 25,
      margin: 40 // (25-15)/25 = 40%
    };

    render(
      <CostStatusIndicator
        product={productWithCost}
        onClick={mockOnClick}
      />
    );

    expect(screen.getByText('40%')).toBeInTheDocument();
    // Chip has role="button" so we check for the AddIcon instead
    expect(screen.queryByTestId('AddIcon')).not.toBeInTheDocument();
  });

  // NEW TEST: Should show appropriate color based on margin
  it('shows success color for good margin (>30%)', () => {
    const productWithGoodMargin = {
      ...mockProduct,
      purchase_price: 10,
      landed_cost: 15,
      selling_price: 25,
      margin: 40
    };

    render(
      <CostStatusIndicator
        product={productWithGoodMargin}
        onClick={mockOnClick}
      />
    );

    const marginChip = screen.getByText('40%');
    // Check for MUI success class instead of style
    expect(marginChip.closest('.MuiChip-root')).toHaveClass('MuiChip-colorSuccess');
  });
});