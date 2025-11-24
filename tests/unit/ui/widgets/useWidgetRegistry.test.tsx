// tests/unit/ui/widgets/useWidgetRegistry.test.tsx
import { renderHook } from '@testing-library/react';
import { useDashboardState } from 'contexts/DashboardStateContext';
import { useAuth } from 'contexts/AuthContext';
import { useWidgetRegistry } from 'components/widgets/useWidgetRegistry';

// Mock the contexts
jest.mock('contexts/DashboardStateContext');
jest.mock('contexts/AuthContext');

const mockUseDashboardState = useDashboardState as jest.MockedFunction<typeof useDashboardState>;
const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

describe.skip('useWidgetRegistry', () => {
  beforeEach(() => {
    mockUseDashboardState.mockReturnValue({
      currentView: 'survival',
      userState: {
        user: { 
          id: 1,
          email: 'test@example.com',
          preferred_mode: 'survival' as const,
          detected_mode: 'survival',
          shopify_connected: true,
          stripe_connected: false,
          first_insight_delivered: true
        },
        milestones: [],
        current_mode: 'survival'
      },
      isLoading: false,
      error: null,
      refetchUserState: jest.fn()
    });

    mockUseAuth.mockReturnValue({
      user: { plan: 'free' },
      isLoggedIn: true,
      isLoading: false,
      accessToken: 'mock-token',
      login: jest.fn(),
      logout: jest.fn(),
      setAccessToken: jest.fn()
    } as any);
  });

  it('should return widgets based on user mode and plan', () => {
    const { result } = renderHook(() => useWidgetRegistry());
    
    expect(result.current.widgets).toHaveLength(3); // Free user gets 3 widgets
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should handle loading state', () => {
    mockUseDashboardState.mockReturnValue({
      currentView: 'survival',
      userState: null,
      isLoading: true,
      error: null,
      refetchUserState: jest.fn()
    });

    const { result } = renderHook(() => useWidgetRegistry());
    
    expect(result.current.isLoading).toBe(true);
    expect(result.current.widgets).toEqual([]);
  });

  it('should handle empty state when no user state', () => {
    mockUseDashboardState.mockReturnValue({
      currentView: 'empty',
      userState: null,
      isLoading: false,
      error: null,
      refetchUserState: jest.fn()
    });

    const { result } = renderHook(() => useWidgetRegistry());
    
    expect(result.current.widgets).toEqual([]);
  });

  it('should update widgets when user plan changes', () => {
    const { result, rerender } = renderHook(() => useWidgetRegistry());
    
    const initialWidgetCount = result.current.widgets.length;

    expect(initialWidgetCount).toBe(3); // Free user starts with 3 widgets
    
    // Change to paid plan
    mockUseAuth.mockReturnValue({
      user: { plan: 'premium' },
      isLoggedIn: true,
      isLoading: false,
      accessToken: 'mock-token',
      login: jest.fn(),
      logout: jest.fn(),
      setAccessToken: jest.fn()
    } as any);
    
    rerender();
    
    expect(result.current.widgets).toHaveLength(4); // Paid user gets 4 widgets
  });
});