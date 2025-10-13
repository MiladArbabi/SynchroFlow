// packages/ui/src/App.test.tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { UserProvider } from './contexts/UserContext';

test('renders the main App component with a title', () => {
  // We must wrap the App in a router because it now contains <Routes>
  render(
    <MemoryRouter>
      <UserProvider>
        <App />
      </UserProvider>
    </MemoryRouter>
  );
  // This test will look for an element that contains the text "SynchroFlow"
  const titleElement = screen.getByRole('heading', { name: /FinOps Command Center/i });
  expect(titleElement).toBeInTheDocument();
});