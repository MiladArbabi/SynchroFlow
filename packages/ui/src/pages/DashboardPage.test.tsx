// packages/ui/src/pages/DashboardPage.test.tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';

test('renders the main dashboard with key metric placeholders', () => {
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );

  // Look for the main page heading
  expect(screen.getByRole('heading', { name: /FinOps Command Center/i })).toBeInTheDocument();

  // Look for placeholders for our future KPI widgets
  expect(screen.getByText(/Total Inventory Value/i)).toBeInTheDocument();
  expect(screen.getByText(/Cash Conversion Cycle/i)).toBeInTheDocument();
});