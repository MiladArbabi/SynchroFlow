import React from 'react';
import { screen } from '@testing-library/react';
import renderWithProviders from 'test-utils';
import FinancesPage from 'pages/FinancesPage';

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

describe('FinancesPage - Financial Intelligence Teaser', () => {
  test('renders the main title and subtitle', () => {
    renderWithProviders(<FinancesPage />);
    
    expect(screen.getByTestId('master-panel-title')).toHaveTextContent('Financial Intelligence');
    expect(screen.getByText('True Profitability Tracking')).toBeInTheDocument();
    expect(screen.getByText('See beyond revenue to actual profit with complete cost visibility')).toBeInTheDocument();
  });

  test('displays the coming soon alert', () => {
    renderWithProviders(<FinancesPage />);
    
    const alert = screen.getByText(/Coming Soon:/);
    expect(alert).toBeInTheDocument();
    expect(screen.getByText(/We're building financial intelligence/)).toBeInTheDocument();
  });

  test('renders all value proposition cards', () => {
    renderWithProviders(<FinancesPage />);
    
    expect(screen.getByText('True Cost Accounting')).toBeInTheDocument();
    expect(screen.getByText('Cash Flow Forecasting')).toBeInTheDocument();
    expect(screen.getByText('Financial Health Scoring')).toBeInTheDocument();
    
    expect(screen.getByText(/Track COGS, shipping costs, payment fees/)).toBeInTheDocument();
    expect(screen.getByText(/Predict future cash flow with AI-powered forecasting/)).toBeInTheDocument();
    expect(screen.getByText(/Get real-time financial health scores/)).toBeInTheDocument();
  });

  test('shows comparison between current and future capabilities', () => {
    renderWithProviders(<FinancesPage />);
    
    expect(screen.getByText("What You See Now vs. What's Coming")).toBeInTheDocument();
    
    // Current capabilities
    expect(screen.getByText('Current (Basic)')).toBeInTheDocument();
    expect(screen.getByText('Shopify revenue tracking')).toBeInTheDocument();
    expect(screen.getByText('Basic order values')).toBeInTheDocument();
    expect(screen.getByText('Estimated metrics only')).toBeInTheDocument();
    
    // Future capabilities
    expect(screen.getByText('Future (Intelligent)')).toBeInTheDocument();
    expect(screen.getByText('True profit margins')).toBeInTheDocument();
    expect(screen.getByText('Cash flow predictions')).toBeInTheDocument();
    expect(screen.getByText('Overhead allocation')).toBeInTheDocument();
    expect(screen.getByText('Financial health monitoring')).toBeInTheDocument();
  });

  test('renders call to action buttons with correct links', () => {
    renderWithProviders(<FinancesPage />);
    
    const connectButton = screen.getByText('Connect Platforms');
    const dashboardButton = screen.getByText('Back to Dashboard');
    
    expect(connectButton).toBeInTheDocument();
    expect(dashboardButton).toBeInTheDocument();
    
    expect(connectButton.closest('a')).toHaveAttribute('href', '/integrations');
    expect(dashboardButton.closest('a')).toHaveAttribute('href', '/dashboard');
  });

  test('renders all icons by their test IDs', () => {
    renderWithProviders(<FinancesPage />);
    
    expect(screen.getByTestId('AccountBalanceIcon')).toBeInTheDocument();
    expect(screen.getByTestId('ReceiptIcon')).toBeInTheDocument();
    expect(screen.getByTestId('ShowChartIcon')).toBeInTheDocument();
    expect(screen.getByTestId('SavingsIcon')).toBeInTheDocument();
    expect(screen.getByTestId('LockOpenIcon')).toBeInTheDocument();
  });

  test('has proper accessibility attributes', () => {
    renderWithProviders(<FinancesPage />);
    
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    
    const mainHeading = screen.getByText('True Profitability Tracking');
    expect(mainHeading.tagName).toBe('H1');
  });
});