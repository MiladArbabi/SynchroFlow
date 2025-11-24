// tests/unit/ui/CustomersPage.test.tsx
import React from 'react';
import { screen } from '@testing-library/react';
import renderWithProviders from '../../../packages/ui/src/test-utils';
import CustomersPage from '../../../packages/ui/src/pages/CustomersPage';

// Mock the MasterPanel component to simplify testing
jest.mock('../../../packages/ui/src/ui-component/MasterPanel/index.tsx', () => {
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

describe('CustomersPage - Identity Resolution Teaser', () => {
  test('renders the main title and subtitle', () => {
    renderWithProviders(<CustomersPage />);
    
    // Check MasterPanel title specifically
    expect(screen.getByTestId('master-panel-title')).toHaveTextContent('Customer Intelligence');
    
    // Check page content titles
    expect(screen.getByText('Unified Customer Intelligence')).toBeInTheDocument();
    expect(screen.getByText('See your customers across all platforms in one place')).toBeInTheDocument();
  });

  test('displays the coming soon alert', () => {
    renderWithProviders(<CustomersPage />);
    
    const alert = screen.getByText(/Coming Soon:/);
    expect(alert).toBeInTheDocument();
    expect(screen.getByText(/We're building advanced customer intelligence/)).toBeInTheDocument();
  });

  test('renders all value proposition cards', () => {
    renderWithProviders(<CustomersPage />);
    
    // Check card titles
    expect(screen.getByText('Cross-Platform Customer Matching')).toBeInTheDocument();
    expect(screen.getByText('Lifetime Value Analysis')).toBeInTheDocument();
    expect(screen.getByText('Predictive Insights')).toBeInTheDocument();
    
    // Check card descriptions
    expect(screen.getByText(/Unify customer data from Shopify/)).toBeInTheDocument();
    expect(screen.getByText(/Calculate true customer lifetime value/)).toBeInTheDocument();
    expect(screen.getByText(/Get churn predictions/)).toBeInTheDocument();
  });

  test('shows comparison between current and future capabilities', () => {
    renderWithProviders(<CustomersPage />);
    
    expect(screen.getByText('What You See Now vs. What\'s Coming')).toBeInTheDocument();
    
    // Current capabilities
    expect(screen.getByText('Current (Basic)')).toBeInTheDocument();
    expect(screen.getByText('Shopify customer data only')).toBeInTheDocument();
    expect(screen.getByText('Basic order history')).toBeInTheDocument();
    expect(screen.getByText('Limited customer insights')).toBeInTheDocument();
    
    // Future capabilities
    expect(screen.getByText('Future (Intelligent)')).toBeInTheDocument();
    expect(screen.getByText('Multi-platform customer profiles')).toBeInTheDocument();
    expect(screen.getByText('True lifetime value calculations')).toBeInTheDocument();
    expect(screen.getByText('Predictive behavior analytics')).toBeInTheDocument();
    expect(screen.getByText('Personalized marketing triggers')).toBeInTheDocument();
  });

  test('renders call to action buttons with correct links', () => {
    renderWithProviders(<CustomersPage />);
    
    const connectButton = screen.getByText('Connect Platforms');
    const dashboardButton = screen.getByText('Back to Dashboard');
    
    expect(connectButton).toBeInTheDocument();
    expect(dashboardButton).toBeInTheDocument();
    
    // Check that buttons have correct routes
    expect(connectButton.closest('a')).toHaveAttribute('href', '/integrations');
    expect(dashboardButton.closest('a')).toHaveAttribute('href', '/dashboard');
  });

  test('renders all icons by their test IDs', () => {
    renderWithProviders(<CustomersPage />);
    
    // Check that MUI icons are rendered (they have specific test IDs)
    expect(screen.getByTestId('ConnectWithoutContactIcon')).toBeInTheDocument();
    expect(screen.getByTestId('GroupIcon')).toBeInTheDocument();
    expect(screen.getByTestId('AnalyticsIcon')).toBeInTheDocument();
    expect(screen.getByTestId('TrendingUpIcon')).toBeInTheDocument();
    expect(screen.getByTestId('LockOpenIcon')).toBeInTheDocument();
  });

  test('does not render old data grid components', () => {
    renderWithProviders(<CustomersPage />);
    
    // These should NOT be in the document anymore
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(screen.queryByText('Customer ID')).not.toBeInTheDocument();
    expect(screen.queryByText('Name')).not.toBeInTheDocument();
    expect(screen.queryByText('Email')).not.toBeInTheDocument();
    expect(screen.queryByText('Total Orders')).not.toBeInTheDocument();
  });

  test('has proper accessibility attributes', () => {
    renderWithProviders(<CustomersPage />);
    
    // Check that alert has proper role
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    
    // Check main content structure
    const mainHeading = screen.getByText('Unified Customer Intelligence');
    expect(mainHeading.tagName).toBe('H1');
  });
});