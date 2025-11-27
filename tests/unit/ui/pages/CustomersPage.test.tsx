// tests/unit/ui/CustomersPage.test.tsx
import React from 'react';
import { screen } from '@testing-library/react';
import renderWithProviders from 'test-utils';
import CustomersPage from 'pages/CustomersPage';

// Mock the MasterPanel component to simplify testing
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

describe('CustomersPage - Specter Conversion Intelligence', () => {
  test('renders the main title and subtitle', () => {
    renderWithProviders(<CustomersPage />);
    
    // Check MasterPanel title specifically
    expect(screen.getByTestId('master-panel-title')).toHaveTextContent('Customer Intelligence');
    
    // Check page content titles
    expect(screen.getByText('Customer Intelligence + Conversion Optimization')).toBeInTheDocument();
    expect(screen.getByText('Real-time behavioral insights and cross-platform customer intelligence')).toBeInTheDocument();
  });

  test('displays all Specter feature chips', () => {
    renderWithProviders(<CustomersPage />);
    
    expect(screen.getByText('Real-time Intent Scoring')).toBeInTheDocument();
    expect(screen.getByText('Exit-Intent Detection')).toBeInTheDocument();
    expect(screen.getByText('A/B Testing')).toBeInTheDocument();
    expect(screen.getByText('Behavioral Analytics')).toBeInTheDocument();
  });

  test('renders all feature cards with descriptions', () => {
    renderWithProviders(<CustomersPage />);
    
    // Check card titles
    expect(screen.getByText('Real-time Intent Scoring')).toBeInTheDocument();
    expect(screen.getByText('Exit-Intent Detection')).toBeInTheDocument();
    expect(screen.getByText('A/B Testing')).toBeInTheDocument();
    expect(screen.getByText('Behavioral Analytics')).toBeInTheDocument();
    
    // Check card descriptions
    expect(screen.getByText(/Track visitor behavior and predict conversion probability/)).toBeInTheDocument();
    expect(screen.getByText(/Capture abandoning visitors and present targeted offers/)).toBeInTheDocument();
    expect(screen.getByText(/Test different offers and interventions/)).toBeInTheDocument();
    expect(screen.getByText(/Understand customer engagement patterns/)).toBeInTheDocument();
  });

  test('renders all feature icons', () => {
    renderWithProviders(<CustomersPage />);
    
    // Check that MUI icons are rendered
    expect(screen.getByTestId('PsychologyIcon')).toBeInTheDocument();
    expect(screen.getByTestId('ExitToAppIcon')).toBeInTheDocument();
    expect(screen.getByTestId('RocketLaunchIcon')).toBeInTheDocument();
    expect(screen.getByTestId('AnalyticsIcon')).toBeInTheDocument();
  });

  test('does not render old content', () => {
    renderWithProviders(<CustomersPage />);
    
    // These should NOT be in the document anymore
    expect(screen.queryByText('Coming Soon:')).not.toBeInTheDocument();
    expect(screen.queryByText('Connect Platforms')).not.toBeInTheDocument();
    expect(screen.queryByText('Back to Dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('What You See Now vs. What\'s Coming')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('has minimal layout without scrolling', () => {
    renderWithProviders(<CustomersPage />);
    
    // Should only have the essential elements
    expect(screen.getByTestId('master-panel-title')).toBeInTheDocument();
    expect(screen.getByText('Customer Intelligence + Conversion Optimization')).toBeInTheDocument();
    expect(screen.getAllByRole('heading').length).toBeLessThan(10); // Minimal headings
  });
});