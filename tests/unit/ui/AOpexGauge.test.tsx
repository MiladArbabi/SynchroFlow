// tests/unit/ui/AOpexGauge.test.tsx
import { screen } from '@testing-library/react';
import { renderWithProviders } from 'test-utils';
// MODIFICATION: Use the 'widgets/' alias

// Mock react-apexcharts
jest.mock('react-apexcharts', () => ({
  __esModule: true,
  default: () => <div data-testid="apexchart-mock" />,
}));

// Mock MainCard
jest.mock('ui-component/cards/MainCard', () => ({
  __esModule: true,
  default: ({ title, children }: { title: React.ReactNode, children: React.ReactNode }) => (
    <div data-testid="main-card-mock">
      {title && <h2>{title}</h2>}
      <div>{children}</div>
    </div>
  ),
}));

describe('AOpexGauge (#281)', () => {
  it('should render the title, formatted value, and chart', () => {
    
    // Assertions
    expect(screen.getByText('Opex Saved')).toBeInTheDocument();
    expect(screen.getByText('$8,125')).toBeInTheDocument();
    expect(screen.getByTestId('apexchart-mock')).toBeInTheDocument();
  });
});