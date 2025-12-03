import React from 'react';
import { screen } from '@testing-library/react';
import renderWithProviders from 'test-utils';
import AnalyticsPage from 'pages/AnalyticsPage';
import MasterPanel from 'ui-component/MasterPanel';

// Mock the MasterPanel component
jest.mock('ui-component/MasterPanel', () => {
  return {
    __esModule: true,
    default: ({ children, title }: { children: React.ReactNode; title: string }) => (
      <div data-testid="master-panel">
        <h1 data-testid="master-panel-title">{title}</h1>
        {children}
      </div>
    ),
  };
});

describe('AnalyticsPage - Advanced Analytics Teaser', () => {
  test('renders the main title and subtitle', () => {
    renderWithProviders(<AnalyticsPage />);
    
    expect(screen.getByTestId('master-panel-title')).toHaveTextContent('Advanced Analytics');
    expect(screen.getByText('Business Intelligence Platform')).toBeInTheDocument();
    expect(screen.getByText('Turn data into actionable insights across your entire business')).toBeInTheDocument();
  });

  test('displays the coming soon alert', () => {
    renderWithProviders(<AnalyticsPage />);
    
    const alert = screen.getByText(/Coming Soon:/);
    expect(alert).toBeInTheDocument();
    expect(screen.getByText(/We're building advanced analytics/)).toBeInTheDocument();
  });

  test('renders all value proposition cards', () => {
    renderWithProviders(<AnalyticsPage />);
    
    expect(screen.getByText('Multi-Platform Funnels')).toBeInTheDocument();
    expect(screen.getByText('Predictive Forecasting')).toBeInTheDocument();
    expect(screen.getByText('Custom Dashboards')).toBeInTheDocument();
    
    expect(screen.getByText(/Track customer journeys from first touch/)).toBeInTheDocument();
    expect(screen.getByText(/AI-powered sales forecasting/)).toBeInTheDocument();
    expect(screen.getByText(/Build custom reports and dashboards/)).toBeInTheDocument();
  });

  test('shows comparison between current and future capabilities', () => {
    renderWithProviders(<AnalyticsPage />);
    
    expect(screen.getByText("What You See Now vs. What's Coming")).toBeInTheDocument();
    
    // Current capabilities
    expect(screen.getByText('Current (Basic)')).toBeInTheDocument();
    expect(screen.getByText('Shopify order analytics')).toBeInTheDocument();
    expect(screen.getByText('Basic revenue tracking')).toBeInTheDocument();
    expect(screen.getByText('Product performance metrics')).toBeInTheDocument();
    
    // Future capabilities
    expect(screen.getByText('Future (Intelligent)')).toBeInTheDocument();
    expect(screen.getByText('Cross-platform attribution')).toBeInTheDocument();
    expect(screen.getByText('Predictive analytics')).toBeInTheDocument();
    expect(screen.getByText('Custom KPI dashboards')).toBeInTheDocument();
    expect(screen.getByText('Automated insight generation')).toBeInTheDocument();
  });

  test('renders call to action buttons with correct links', () => {
    renderWithProviders(<AnalyticsPage />);
    
    const connectButton = screen.getByText('Connect Platforms');
    const dashboardButton = screen.getByText('Back to Dashboard');
    
    expect(connectButton).toBeInTheDocument();
    expect(dashboardButton).toBeInTheDocument();
    
    expect(connectButton.closest('a')).toHaveAttribute('href', '/integrations');
    expect(dashboardButton.closest('a')).toHaveAttribute('href', '/dashboard');
  });

  test('renders all icons by their test IDs', () => {
    renderWithProviders(<AnalyticsPage />);
    
    expect(screen.getByTestId('AnalyticsIcon')).toBeInTheDocument();
    expect(screen.getByTestId('TimelineIcon')).toBeInTheDocument();
    expect(screen.getByTestId('TrendingUpIcon')).toBeInTheDocument();
    expect(screen.getByTestId('BarChartIcon')).toBeInTheDocument();
    expect(screen.getByTestId('LockOpenIcon')).toBeInTheDocument();
  });

  test('has proper accessibility attributes', () => {
    renderWithProviders(<AnalyticsPage />);
    
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    
    const mainHeading = screen.getByText('Business Intelligence Platform');
    expect(mainHeading.tagName).toBe('H1');
  });
});