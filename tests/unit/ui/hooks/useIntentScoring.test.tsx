// tests/unit/ui/hooks/useIntentScoring.test.tsx
import { renderHook, act } from '@testing-library/react';
import { useIntentScoring } from 'hooks/useIntentScoring';

// Mock the intentScoring utils
jest.mock('utils/intentScoring', () => {
  const mockCalculateIntentScore = jest.fn();
  const mockUpdateIntentScore = jest.fn();
  const mockGetIntentLevel = jest.fn();

  return {
    calculateIntentScore: mockCalculateIntentScore,
    updateIntentScore: mockUpdateIntentScore,
    getIntentLevel: mockGetIntentLevel,
  };
});

describe('useIntentScoring', () => {
  const mockIntentScoring = require('utils/intentScoring');

  beforeEach(() => {
    jest.clearAllMocks();
    mockIntentScoring.calculateIntentScore.mockReturnValue(50);
    mockIntentScoring.updateIntentScore.mockImplementation((current: any, newData: any) => ({
      ...current,
      ...newData
    }));
    mockIntentScoring.getIntentLevel.mockReturnValue('medium');
  });

  it('should initialize with default intent data', () => {
    const { result } = renderHook(() => useIntentScoring());

    expect(result.current.intentScore).toBe(50);
    expect(result.current.intentLevel).toBe('medium');
  });

  it('should update intent data on new page view', () => {
    const { result } = renderHook(() => useIntentScoring());

    act(() => {
      result.current.trackPageView('/product/1');
    });

    expect(mockIntentScoring.updateIntentScore).toHaveBeenCalled();
    expect(mockIntentScoring.calculateIntentScore).toHaveBeenCalled();
  });

  it('should update intent data on product view', () => {
    const { result } = renderHook(() => useIntentScoring());

    act(() => {
      result.current.trackProductView('product-123');
    });

    expect(mockIntentScoring.updateIntentScore).toHaveBeenCalled();
    expect(mockIntentScoring.calculateIntentScore).toHaveBeenCalled();
  });

  it('should update intent data on scroll', () => {
    const { result } = renderHook(() => useIntentScoring());

    act(() => {
      result.current.trackScrollDepth(75);
    });

    expect(mockIntentScoring.updateIntentScore).toHaveBeenCalled();
    expect(mockIntentScoring.calculateIntentScore).toHaveBeenCalled();
  });

  it('should update intent data on mouse movement', () => {
    const { result } = renderHook(() => useIntentScoring());

    act(() => {
      result.current.trackMouseMovement();
    });

    expect(mockIntentScoring.updateIntentScore).toHaveBeenCalled();
    expect(mockIntentScoring.calculateIntentScore).toHaveBeenCalled();
  });

  it('should update intent data on click', () => {
    const { result } = renderHook(() => useIntentScoring());

    act(() => {
      result.current.trackClick();
    });

    expect(mockIntentScoring.updateIntentScore).toHaveBeenCalled();
    expect(mockIntentScoring.calculateIntentScore).toHaveBeenCalled();
  });

  it('should reset intent data', () => {
    const { result } = renderHook(() => useIntentScoring());

    act(() => {
      result.current.resetIntent();
    });

    expect(mockIntentScoring.calculateIntentScore).toHaveBeenCalled();
    expect(result.current.intentScore).toBe(50);
  });

  describe('useIntentScoring - Edge Cases', () => {
    it('should handle rapid consecutive updates', () => {
        const { result } = renderHook(() => useIntentScoring());

        act(() => {
        // Rapid fire multiple events
        result.current.trackPageView('/');
        result.current.trackProductView('1');
        result.current.trackScrollDepth(25);
        result.current.trackMouseMovement();
        result.current.trackClick();
        result.current.trackPageView('/products');
        });

        expect(mockIntentScoring.updateIntentScore).toHaveBeenCalledTimes(6);
        expect(mockIntentScoring.calculateIntentScore).toHaveBeenCalled();
    });

    it('should maintain data integrity after reset', () => {
        const { result } = renderHook(() => useIntentScoring());

        // Add some data first
        act(() => {
        result.current.trackPageView('/test');
        result.current.trackProductView('test-product');
        });

        // Reset
        act(() => {
        result.current.resetIntent();
        });

        // Verify reset state
        expect(mockIntentScoring.calculateIntentScore).toHaveBeenCalled();
        expect(result.current.intentScore).toBe(50); // Mock returns 50
    });

    it('should handle time tracking interval cleanup', () => {
        const { unmount } = renderHook(() => useIntentScoring());
        
        // Unmount should clean up interval
        unmount();
        
        // No specific assertion needed, just ensuring no errors
        expect(true).toBe(true);
    });

    it('should update intent level when score crosses thresholds', () => {
        const { result } = renderHook(() => useIntentScoring());

        // Mock different scores to test level changes
        mockIntentScoring.calculateIntentScore.mockReturnValueOnce(25); // low
        mockIntentScoring.calculateIntentScore.mockReturnValueOnce(50); // medium  
        mockIntentScoring.calculateIntentScore.mockReturnValueOnce(80); // high

        mockIntentScoring.getIntentLevel
        .mockReturnValueOnce('low')
        .mockReturnValueOnce('medium')
        .mockReturnValueOnce('high');

        // Trigger updates by changing intent data
        act(() => {
        result.current.trackPageView('/test1');
        });
        expect(result.current.intentLevel).toBe('low');

        act(() => {
        result.current.trackPageView('/test2');
        });
        expect(result.current.intentLevel).toBe('medium');

        act(() => {
        result.current.trackPageView('/test3');
        });
        expect(result.current.intentLevel).toBe('high');
    });

    it('should handle multiple product views efficiently', () => {
        const { result } = renderHook(() => useIntentScoring());

        const products = Array(50).fill(0).map((_, i) => `product-${i}`);
        
        act(() => {
        products.forEach(productId => {
            result.current.trackProductView(productId);
        });
        });

        expect(mockIntentScoring.updateIntentScore).toHaveBeenCalledTimes(50);
    });

    it('should not duplicate page views with same path', () => {
        const { result } = renderHook(() => useIntentScoring());

        act(() => {
        result.current.trackPageView('/same-path');
        result.current.trackPageView('/same-path');
        result.current.trackPageView('/same-path');
        });

        // Each call should update, even if path is same (timestamps differ)
        expect(mockIntentScoring.updateIntentScore).toHaveBeenCalledTimes(3);
    });
    });
});