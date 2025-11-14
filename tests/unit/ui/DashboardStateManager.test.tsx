// tests/unit/ui/DashboardStateManager.test.tsx
import { render, screen } from '@testing-library/react';
import { DashboardStateProvider, useDashboardState } from '../../../packages/ui/src/contexts/DashboardStateContext';
import { AuthProvider } from '../../../packages/ui/src/contexts/AuthContext';

// Mock the API call
jest.mock('axios');
jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
}));

const TestComponent = () => {
  const { currentView, isLoading } = useDashboardState();
  return (
    <div>
      <span data-testid="current-view">{currentView}</span>
      <span data-testid="loading">{isLoading ? 'loading' : 'loaded'}</span>
    </div>
  );
};

describe('DashboardStateManager', () => {
  it('should show empty state for user without Shopify connection', () => {
    // Mock useQuery to return user without Shopify connection
    const mockUseQuery = require('@tanstack/react-query').useQuery;
    mockUseQuery.mockReturnValue({
      data: {
        user: { shopify_connected: false, detected_mode: 'survival' },
        milestones: [],
        current_mode: 'survival'
      },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });

    render(
      <AuthProvider>
        <DashboardStateProvider>
          <TestComponent />
        </DashboardStateProvider>
      </AuthProvider>
    );

    expect(screen.getByTestId('current-view')).toHaveTextContent('empty');
  });
});