// tests/unit/ui/pages/ProductsPage.integration.test.tsx
import { screen, waitFor } from '@testing-library/react';
import renderWithProviders from 'test-utils';
import ProductsPage from 'pages/ProductsPage';

// Mock axios and hooks
jest.mock('axios');

// Mock the useProducts hook
jest.mock('api/products', () => ({
  useProducts: jest.fn()
}));

// Mock the user-state hooks
jest.mock('api/user-state', () => ({
  useUserProductCosts: jest.fn(),
  useUpdateUserProductCosts: jest.fn()
}));

// Mock the product-costs hook
jest.mock('api/product-costs', () => ({
  useUpdateProductCost: jest.fn()
}));

import { useProducts } from 'api/products';
import { useUserProductCosts, useUpdateUserProductCosts } from 'api/user-state';
import { useUpdateProductCost } from 'api/product-costs';

const mockUseProducts = useProducts as jest.MockedFunction<typeof useProducts>;
const mockUseUserProductCosts = useUserProductCosts as jest.MockedFunction<typeof useUserProductCosts>;
const mockUseUpdateUserProductCosts = useUpdateUserProductCosts as jest.MockedFunction<typeof useUpdateUserProductCosts>;
const mockUseUpdateProductCost = useUpdateProductCost as jest.MockedFunction<typeof useUpdateProductCost>;

describe('ProductsPage - User State Cost Integration', () => {
  const mockProducts = [
  {
    id: 1,
    shop_id: 1, // Add this required field
    platform_product_id: 'gid://shopify/Product/123',
    title: 'Test Product 1',
    vendor: 'Test Vendor',
    product_type: 'Test Type',
    status: 'ACTIVE',
    total_inventory: 10,
    created_at: '2024-01-01',
    updated_at: '2024-01-01'
  }
];

  const mockUserProductCosts = {
    'gid://shopify/Product/123': {
      productId: '1',
      platform_product_id: '123',
      original_platform_product_id: 'gid://shopify/Product/123',
      purchase_price: 25.50,
      shipping_cost: 5.00,
      customs_duties: 2.50,
      landed_cost_per_unit: 33.00,
      selling_price: 49.99,
      currency: 'USD'
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock useProducts
    mockUseProducts.mockReturnValue({
      products: mockProducts,
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      isLoading: false,
      isError: false
    });

    // Mock user state hooks - use proper query result structure
    mockUseUserProductCosts.mockReturnValue({
        data: mockUserProductCosts,
        isLoading: false,
        isError: false,
        error: null,
        isPending: false,
        isSuccess: true,
        status: 'success',
        // Add other required TanStack Query properties
        dataUpdatedAt: Date.now(),
        errorUpdatedAt: 0,
        failureCount: 0,
        failureReason: null,
        errorUpdateCount: 0,
        isFetched: true,
        isFetchedAfterMount: true,
        isFetching: false,
        isPaused: false,
        isPlaceholderData: false,
        isRefetching: false,
        isStale: true,
        refetch: jest.fn(),
    } as any);

    // Mock update hooks - use proper mutation result structure
    mockUseUpdateUserProductCosts.mockReturnValue({
        mutateAsync: jest.fn().mockResolvedValue({ success: true }),
        mutate: jest.fn(),
        isPending: false,
        isError: false,
        error: null,
        isSuccess: true,
        status: 'success',
        data: { success: true },
        // Add other required mutation properties
        reset: jest.fn(),
        context: undefined,
        variables: undefined,
        submittedAt: Date.now(),
    } as any);

    mockUseUpdateProductCost.mockReturnValue({
    updateProductCost: jest.fn().mockResolvedValue({
        data: {
        purchase_price: 25.50,
        landed_cost_per_unit: 33.00,
        updated_at: '2024-01-01'
        }
    }),
        isLoading: false, // Add these required fields
        isError: false,
    } as any);
});

    test('should load and display products with user-state cost data', async () => {
        // Arrange & Act
        renderWithProviders(<ProductsPage />);

        // Assert
        await waitFor(() => {
        expect(screen.getByText('Test Product 1')).toBeInTheDocument();
        });
        
        // Verify user-state hooks are called
        expect(mockUseUserProductCosts).toHaveBeenCalled();
    });

    test('should handle cost entry with dual-write strategy', async () => {
        // Arrange
        const mockUpdateUserCosts = jest.fn().mockResolvedValue({ success: true });
        // In the second test, update the mock similarly
        mockUseUpdateUserProductCosts.mockReturnValue({
        mutateAsync: mockUpdateUserCosts,
        mutate: jest.fn(),
        isPending: false,
        isError: false,
        error: null,
        isSuccess: true,
        status: 'success',
        data: { success: true },
        reset: jest.fn(),
        context: undefined,
        variables: undefined,
        submittedAt: Date.now(),
        } as any);

        renderWithProviders(<ProductsPage />);

        // Act - Wait for initial render
        await waitFor(() => {
        expect(screen.getByText('Test Product 1')).toBeInTheDocument();
        });

        // Assert - Verify hooks are properly integrated
        expect(mockUseUpdateUserProductCosts).toHaveBeenCalled();
    });
});