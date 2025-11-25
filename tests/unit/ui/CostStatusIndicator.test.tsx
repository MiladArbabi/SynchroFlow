// packages/ui/src/components/__tests__/CostStatusIndicator.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { CostStatusIndicator } from '../../../packages/ui/src/components/CostStatusIndicator';

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
});