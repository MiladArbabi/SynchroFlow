// apps/frontend/src/components/__tests__/CostEntryModal.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { CostEntryModal } from 'components/CostEntryModal';

// Mock the child components with better implementation
jest.mock('ui-component/cards/MainCard', () => ({
  __esModule: true,
  default: ({ children, title, secondary }: any) => (
    <div data-testid="main-card">
      <div data-testid="card-header">
        <h1>{title}</h1>
        {secondary}
      </div>
      {children}
    </div>
  )
}));

jest.mock('ui-component/extended/Form/CustomFormControl', () => ({
  __esModule: true,
  default: ({ children }: any) => (
    <div data-testid="custom-form-control">{children}</div>
  )
}));

// Mock the CloseIcon
jest.mock('@mui/icons-material/Close', () => ({
  __esModule: true,
  default: () => <span data-testid="close-icon">×</span>
}));

const mockProduct = {
  id: 1,
  shop_id: 1,
  platform_product_id: 'prod_123',
  title: 'Test Product',
  vendor: 'Test Vendor',
  product_type: 'Test Type',
  status: 'active',
  total_inventory: 10,
  created_at: '2024-01-01',
  updated_at: '2024-01-01'
};

describe('CostEntryModal', () => {
  const mockOnClose = jest.fn();
  const mockOnSave = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders modal when open is true', () => {
    render(
      <CostEntryModal
        open={true}
        product={mockProduct}
        onClose={mockOnClose}
        onSave={mockOnSave}
      />
    );

    expect(screen.getByText(`Cost Entry - ${mockProduct.title}`)).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    render(
      <CostEntryModal
        open={true}
        product={mockProduct}
        onClose={mockOnClose}
        onSave={mockOnSave}
      />
    );

    // Find the close button by test ID since the aria-label might not be set in our mock
    const closeButton = screen.getByTestId('CloseIcon').closest('button');
    fireEvent.click(closeButton!);
    
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('does not render when open is false', () => {
    render(
      <CostEntryModal
        open={false}
        product={mockProduct}
        onClose={mockOnClose}
        onSave={mockOnSave}
      />
    );

    expect(screen.queryByText(`Cost Entry - ${mockProduct.title}`)).not.toBeInTheDocument();
  });

  it('displays all required input fields', () => {
    render(
      <CostEntryModal
        open={true}
        product={mockProduct}
        onClose={mockOnClose}
        onSave={mockOnSave}
      />
    );

    expect(screen.getByLabelText(/purchase price/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/shipping from supplier/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/customs\/duties/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/packaging materials/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/selling price/i)).toBeInTheDocument();
    expect(screen.getByText(/total landed cost/i)).toBeInTheDocument();
  });

  describe('Cost Breakdown', () => {
  it('should render essential cost breakdown fields', () => {
    render(
      <CostEntryModal
        open={true}
        product={mockProduct}
        onClose={mockOnClose}
        onSave={mockOnSave}
      />
    );

    expect(screen.getByLabelText('Purchase Price')).toBeInTheDocument();
    expect(screen.getByLabelText('Shipping from Supplier')).toBeInTheDocument();
    expect(screen.getByLabelText('Customs/Duties')).toBeInTheDocument();
    expect(screen.getByLabelText('Packaging Materials')).toBeInTheDocument();
    
    // Check for the total landed cost section (it's split across elements)
    expect(screen.getByText('Total Landed Cost:')).toBeInTheDocument();
    expect(screen.getByText('$0.00')).toBeInTheDocument();
  });

  it('should calculate total landed cost from components', () => {
    render(
      <CostEntryModal
        open={true}
        product={mockProduct}
        onClose={mockOnClose}
        onSave={mockOnSave}
      />
    );

    fireEvent.change(screen.getByLabelText('Purchase Price'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Shipping from Supplier'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Customs/Duties'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Packaging Materials'), { target: { value: '1' } });

    // The total should now be $18.00
    expect(screen.getByText('$18.00')).toBeInTheDocument();
  });

    it('should allow adding dynamic cost fields', () => {
      render(
          <CostEntryModal
            open={true}
            product={mockProduct}
            onClose={mockOnClose}
            onSave={mockOnSave}
          />
        );

        expect(screen.getByPlaceholderText('Cost name')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Amount')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument();
      });
    });
});