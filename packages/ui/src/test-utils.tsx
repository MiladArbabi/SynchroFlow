/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { MemoryRouter, MemoryRouterProps } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { UserProvider } from './contexts/UserContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IntlProvider } from 'react-intl';
import { PostHogProvider } from 'posthog-js/react';
import { EnhancedWidgetShellProps } from './components/widgets/types';

// PostHog configuration for tests
const posthogKey = import.meta.env.VITE_PUBLIC_POSTHOG_KEY as string;
const posthogOptions = {
  api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
  // Remove the 'defaults' property entirely - it's not needed for tests
  capture_exceptions: false, // Set to false for tests to avoid side effects
  debug: false, // Disable debug in tests
};

// --- Create a new QueryClient for each test ---
const createTestQueryClient = () => new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

// ===== TEST DATA FACTORIES =====
// Reusable mock data for EnhancedWidgetShell tests
export const mockMetricConfig = {
  type: 'financial' as const,
  urgencyThresholds: {
    critical: 3,
    high: 6,
    medium: 12,
    low: 12
  },
  idealRanges: { min: 6, max: 18 },
  industryBenchmarks: {
    poor: 3,
    average: 6,
    good: 12,
    excellent: 18
  }
};

export const createEnhancedWidgetProps = (overrides: Partial<EnhancedWidgetShellProps> = {}): EnhancedWidgetShellProps => ({
  id: 'test-widget',
  title: 'Test Widget',
  children: <div data-testid="test-children">Test Content</div>,
  intelligenceLevel: 'L1',
  isLoading: false,
  isEmpty: false,
  currentValue: 100,
  format: 'number',
  businessContext: {
    stage: 'survival',
    revenueBand: '100k',
    burningPriority: 'cash-flow',
    timeContext: 'realtime'
  },
  metricConfig: mockMetricConfig,
  ...overrides
});

export const createL3WidgetProps = (overrides: Partial<EnhancedWidgetShellProps> = {}): EnhancedWidgetShellProps => ({
  ...createEnhancedWidgetProps(),
  intelligenceLevel: 'L3',
  insightText: 'Test insight message',
  insightSeverity: 'warning',
  primaryAction: {
    label: 'Test Action',
    onClick: jest.fn(),
    variant: 'primary' as const,
    workflowType: 'cash-optimization',
    expectedImpact: 'high',
    timeToComplete: 'minutes'
  },
  ...overrides
});

// ===== RENDER UTILITIES =====
interface ExtendedRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  routerProps?: MemoryRouterProps;
}

// Full app context render (for integration tests)
const renderWithProviders = (
  ui: ReactElement,
  { routerProps, ...renderOptions }: ExtendedRenderOptions = {}
) => {
  const AllTheProviders = ({ children }: { children: React.ReactNode }) => {
    const theme = createTheme();
    const queryClient = createTestQueryClient();

    return (
      <PostHogProvider apiKey={posthogKey} options={posthogOptions}>
        <QueryClientProvider client={queryClient}>
          <IntlProvider locale="en" defaultLocale="en" messages={{}}>
            <MemoryRouter {...routerProps}>
              <ThemeProvider theme={theme}>
                <CssBaseline />
                <UserProvider>
                  {children}
                </UserProvider>
              </ThemeProvider>
            </MemoryRouter>
          </IntlProvider>
        </QueryClientProvider>
      </PostHogProvider>
    );
  };

  return render(ui, { wrapper: AllTheProviders, ...renderOptions });
};

// Minimal theme-only render (for unit tests)
const renderWithTheme = (ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) => {
  const theme = createTheme();
  
  const ThemeWrapper = ({ children }: { children: React.ReactNode }) => (
    <ThemeProvider theme={theme}>
      {children}
    </ThemeProvider>
  );

  return render(ui, { wrapper: ThemeWrapper, ...options });
};

// ===== MOCK UTILITIES =====
const mockResizeObserver = () => {
  // Add proper TypeScript declaration for global
  (global as typeof globalThis & { ResizeObserver: any }).ResizeObserver = jest.fn().mockImplementation(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
  }));
};

// ===== EXPORTS =====
export {
  renderWithProviders,
  renderWithTheme,
  mockResizeObserver,
  createTestQueryClient,
};

// Default export for convenience
export default renderWithProviders;