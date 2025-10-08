// packages/ui/src/App.test.tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

test('renders the main App component with a title', () => {
  // We must wrap the App in a router because it now contains <Routes>
  render(
    <MemoryRouter>
      <App />
    </MemoryRouter>
  );
  // This test will look for an element that contains the text "SynchroFlow"
  const titleElement = screen.getByRole('heading', { name: /Dashboard/i });
  expect(titleElement).toBeInTheDocument();
});