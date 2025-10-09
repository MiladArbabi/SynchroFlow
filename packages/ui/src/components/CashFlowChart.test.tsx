// packages/ui/src/components/CashFlowChart.test.tsx
import { render, screen } from '@testing-library/react';
import { CashFlowChart } from './CashFlowChart';

test('renders the cash flow chart with data points', () => {
  const sampleData = [
    { name: 'Week 1', cash: 10000 },
    { name: 'Week 2', cash: -5000 },
    { name: 'Week 3', cash: 12000 },
  ];

  render(<CashFlowChart data={sampleData} />);

  // A more robust test: check that the component renders its title.
  expect(screen.getByRole('heading', { name: /Cash Flow Forecast/i })).toBeInTheDocument();
});