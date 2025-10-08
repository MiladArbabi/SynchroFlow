// packages/ui/src/App.test.tsx
import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the main App component with a title', () => {
  render(<App />);
  // This test will look for an element that contains the text "SynchroFlow"
  const titleElement = screen.getByText(/SynchroFlow/i);
  expect(titleElement).toBeInTheDocument();
});