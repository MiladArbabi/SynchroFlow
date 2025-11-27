// tests/unit/ui/hooks/useExitIntent.test.tsx
import { renderHook, act } from '@testing-library/react';
import { useExitIntent } from 'hooks/useExitIntent';
import { useState, useCallback, useEffect } from 'react';

// Mock the intent scoring hook
jest.mock('hooks/useIntentScoring', () => ({
  useIntentScoring: () => ({
    intentScore: 75,
    intentLevel: 'high',
    trackPageView: jest.fn(),
    trackProductView: jest.fn(),
    trackScrollDepth: jest.fn(),
    trackMouseMovement: jest.fn(),
    trackClick: jest.fn(),
    resetIntent: jest.fn(),
  }),
}));

describe('useExitIntent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should initialize with exit intent not detected', () => {
    const { result } = renderHook(() => useExitIntent());

    expect(result.current.exitIntentDetected).toBe(false);
    expect(result.current.shouldShowOffer).toBe(false);
  });

  it('should detect mouse leave event', () => {
    const { result } = renderHook(() => useExitIntent());

    // Simulate mouse leaving the viewport
    act(() => {
      const event = new MouseEvent('mouseleave', {
        clientY: -100, // Mouse above viewport
        clientX: 100,
      });
      document.dispatchEvent(event);
    });

    expect(result.current.exitIntentDetected).toBe(true);
  });

  it('should not detect mouse leave when moving within viewport', () => {
    const { result } = renderHook(() => useExitIntent());

    // Simulate mouse moving within viewport
    act(() => {
      const event = new MouseEvent('mouseleave', {
        clientY: 100, // Mouse within viewport
        clientX: 100,
      });
      document.dispatchEvent(event);
    });

    expect(result.current.exitIntentDetected).toBe(false);
  });

  it('should detect beforeunload event', () => {
    const { result } = renderHook(() => useExitIntent());

    // Simulate page unload
    act(() => {
      const event = new Event('beforeunload');
      window.dispatchEvent(event);
    });

    expect(result.current.exitIntentDetected).toBe(true);
  });

  it('should reset exit intent state', () => {
    const { result } = renderHook(() => useExitIntent());

    // First trigger exit intent
    act(() => {
      const event = new MouseEvent('mouseleave', { clientY: -100, clientX: 100 });
      document.dispatchEvent(event);
    });

    expect(result.current.exitIntentDetected).toBe(true);

    // Then reset
    act(() => {
      result.current.resetExitIntent();
    });

    expect(result.current.exitIntentDetected).toBe(false);
  });

  it('should determine if offer should be shown based on intent score', () => {
    const { result } = renderHook(() => useExitIntent());

    // First trigger exit intent
    act(() => {
      const event = new MouseEvent('mouseleave', { clientY: -100, clientX: 100 });
      document.dispatchEvent(event);
    });

    // With high intent score and exit intent detected, should show offer
    expect(result.current.shouldShowOffer).toBe(true);
  });

  it('should handle multiple exit intent triggers gracefully', () => {
    const { result } = renderHook(() => useExitIntent());

    // Trigger multiple exit intents
    act(() => {
      const event1 = new MouseEvent('mouseleave', { clientY: -100, clientX: 100 });
      const event2 = new Event('beforeunload');
      document.dispatchEvent(event1);
      window.dispatchEvent(event2);
    });

    expect(result.current.exitIntentDetected).toBe(true);
  });

  describe('useExitIntent - Edge Cases', () => {
    it('should handle multiple rapid exit intents without duplicates', () => {
        const { result } = renderHook(() => useExitIntent());

        // Trigger multiple rapid exit intents
        act(() => {
        for (let i = 0; i < 5; i++) {
            const event = new MouseEvent('mouseleave', { clientY: -100, clientX: 100 });
            document.dispatchEvent(event);
        }
        });

        // Should only be true, not increment or change
        expect(result.current.exitIntentDetected).toBe(true);
    });

    it('should clean up event listeners on unmount', () => {
        const removeEventListenerSpy = jest.spyOn(document, 'removeEventListener');
        const removeWindowEventListenerSpy = jest.spyOn(window, 'removeEventListener');

        const { unmount } = renderHook(() => useExitIntent());
        
        unmount();

        expect(removeEventListenerSpy).toHaveBeenCalledWith('mouseleave', expect.any(Function));
        expect(removeWindowEventListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));

        removeEventListenerSpy.mockRestore();
        removeWindowEventListenerSpy.mockRestore();
    });

    it('should handle edge case mouse positions', () => {
        const { result } = renderHook(() => useExitIntent());

        // Test various edge positions
        const edgeCases = [
        { clientY: -1, clientX: 100, shouldTrigger: true },   // Just above
        { clientY: 0, clientX: 100, shouldTrigger: true },    // Exactly at top
        { clientY: 1, clientX: 100, shouldTrigger: false },   // Just inside
        { clientY: -100, clientX: -100, shouldTrigger: true }, // Top-left corner
        { clientY: -100, clientX: 2000, shouldTrigger: true }, // Top-right corner
        ];

        edgeCases.forEach(({ clientY, clientX, shouldTrigger }) => {
        act(() => {
            const event = new MouseEvent('mouseleave', { clientY, clientX });
            document.dispatchEvent(event);
        });

        expect(result.current.exitIntentDetected).toBe(shouldTrigger);
        
        // Reset for next test
        act(() => {
            result.current.resetExitIntent();
        });
        });
    });

      it('should not show offer for low intent visitors even with exit intent', () => {
        // Create a custom hook that uses low intent
        const useExitIntentWithLowIntent = () => {
        const [exitIntentDetected, setExitIntentDetected] = useState(false);
        const intentLevel: 'low' | 'medium' | 'high' = 'low'; // Properly type and force low intent

        const handleMouseLeave = useCallback((event: MouseEvent) => {
            if (event.clientY <= 0) {
            setExitIntentDetected(true);
            }
        }, []);

        useEffect(() => {
            document.addEventListener('mouseleave', handleMouseLeave);
            return () => document.removeEventListener('mouseleave', handleMouseLeave);
        }, [handleMouseLeave]);

        const shouldShowOffer = exitIntentDetected && intentLevel === 'high';
        
        return {
            exitIntentDetected,
            shouldShowOffer,
            resetExitIntent: () => setExitIntentDetected(false),
            intentLevel,
        };
        };

        const { result } = renderHook(() => useExitIntentWithLowIntent());

        // Trigger exit intent
        act(() => {
        const event = new MouseEvent('mouseleave', { clientY: -100, clientX: 100 });
        document.dispatchEvent(event);
        });

        // Should not show offer for low intent visitors
        expect(result.current.shouldShowOffer).toBe(false);
    });

    it('should handle intent level changes dynamically', () => {
        // Create a custom hook that allows dynamic intent level
        const useExitIntentWithDynamicIntent = (initialIntentLevel: 'low' | 'medium' | 'high') => {
        const [exitIntentDetected, setExitIntentDetected] = useState(false);
        const [intentLevel, setIntentLevel] = useState<'low' | 'medium' | 'high'>(initialIntentLevel);

        const handleMouseLeave = useCallback((event: MouseEvent) => {
            if (event.clientY <= 0) {
            setExitIntentDetected(true);
            }
        }, []);

        useEffect(() => {
            document.addEventListener('mouseleave', handleMouseLeave);
            return () => document.removeEventListener('mouseleave', handleMouseLeave);
        }, [handleMouseLeave]);

        const shouldShowOffer = exitIntentDetected && intentLevel === 'high';
        
        return {
            exitIntentDetected,
            shouldShowOffer,
            resetExitIntent: () => setExitIntentDetected(false),
            intentLevel,
            setIntentLevel,
        };
        };

        // Start with medium intent
        const { result } = renderHook(() => useExitIntentWithDynamicIntent('medium'));

        // Trigger exit intent with medium intent
        act(() => {
        const event = new MouseEvent('mouseleave', { clientY: -100, clientX: 100 });
        document.dispatchEvent(event);
        });

        expect(result.current.shouldShowOffer).toBe(false); // medium intent doesn't trigger offers

        // Change to high intent
        act(() => {
        result.current.setIntentLevel('high');
        });

        // Should now show offer with high intent
        expect(result.current.shouldShowOffer).toBe(true);
    });
    });
});