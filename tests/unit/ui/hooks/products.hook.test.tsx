// tests/unit/ui/hooks/products.hook.test.tsx
import { renderHook, waitFor } from '@testing-library/react';
import { useProducts, useProduct } from 'api/products'
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Products Hooks', () => {
  beforeEach(() => {
  jest.clearAllMocks();
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn(() => 'test-token'),
        setItem: jest.fn(),
        removeItem: jest.fn(),
        clear: jest.fn(),
      },
      writable: true
    });
  });

  describe('useProducts', () => {
    it('should fetch products with default parameters', async () => {
      const mockResponse = {
        data: {
          products: [{ id: 1, title: 'Test Product' }],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 }
        }
      };
      mockedAxios.get.mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useProducts());

      expect(result.current.isLoading).toBe(true);
      expect(result.current.products).toEqual([]);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.products).toEqual(mockResponse.data.products);
      expect(result.current.pagination).toEqual(mockResponse.data.pagination);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        '/api/v1/products?page=1&limit=20',
        { headers: { Authorization: 'Bearer test-token' } }
      );
    });

    it('should fetch products with custom parameters', async () => {
      const mockResponse = {
        data: {
          products: [],
          pagination: { page: 2, limit: 10, total: 0, totalPages: 0 }
        }
      };
      mockedAxios.get.mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useProducts(2, 10, 'snowboard'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockedAxios.get).toHaveBeenCalledWith(
        '/api/v1/products?page=2&limit=10&search=snowboard',
        { headers: { Authorization: 'Bearer test-token' } }
      );
    });

    it('should handle API errors', async () => {
      mockedAxios.get.mockRejectedValue(new Error('API error'));

      const { result } = renderHook(() => useProducts());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isError).toBe(true);
      expect(result.current.products).toEqual([]);
    });

    it('should re-fetch when parameters change', async () => {
      const mockResponse1 = {
        data: {
          products: [{ id: 1, title: 'Product 1' }],
          pagination: { page: 1, limit: 20, total: 2, totalPages: 1 }
        }
      };
      const mockResponse2 = {
        data: {
          products: [{ id: 2, title: 'Product 2' }],
          pagination: { page: 2, limit: 20, total: 2, totalPages: 1 }
        }
      };

      mockedAxios.get
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockResponse2);

      const { result, rerender } = renderHook(
        ({ page }) => useProducts(page, 20),
        { initialProps: { page: 1 } }
      );

      await waitFor(() => {
        expect(result.current.products[0]?.id).toBe(1);
      });

      // Change page
      rerender({ page: 2 });

      await waitFor(() => {
        expect(result.current.products[0]?.id).toBe(2);
      });

      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('useProduct', () => {
    it('should fetch single product by ID', async () => {
      const mockProductsResponse = {
        data: {
          products: [
            { id: 1, platform_product_id: 'gid://shopify/Product/1', title: 'Test Product' },
            { id: 2, platform_product_id: 'gid://shopify/Product/2', title: 'Another Product' }
          ],
          pagination: { page: 1, limit: 1000, total: 2, totalPages: 1 }
        }
      };
      mockedAxios.get.mockResolvedValue(mockProductsResponse);

      const { result } = renderHook(() => useProduct('1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.product).toEqual(mockProductsResponse.data.products[0]);
      expect(result.current.isError).toBe(false);
    });

    it('should handle product not found', async () => {
      const mockProductsResponse = {
        data: {
          products: [
            { id: 1, platform_product_id: 'gid://shopify/Product/1', title: 'Test Product' }
          ],
          pagination: { page: 1, limit: 1000, total: 1, totalPages: 1 }
        }
      };
      mockedAxios.get.mockResolvedValue(mockProductsResponse);

      const { result } = renderHook(() => useProduct('999'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.product).toBeNull();
      expect(result.current.isError).toBe(true);
    });

    it('should handle API errors in useProduct', async () => {
      mockedAxios.get.mockRejectedValue(new Error('API error'));

      const { result } = renderHook(() => useProduct('1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isError).toBe(true);
      expect(result.current.product).toBeNull();
    });
  });
});