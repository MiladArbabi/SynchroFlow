import { ReactNode } from 'react';
import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
// --- IMPORT THE *CORRECT* CONTEXT AND PROVIDER ---
import { ConfigProvider } from 'contexts/ConfigContext'; // Use alias
import useConfig from 'hooks/useConfig'; // The hook that consumes ConfigContext

// A simple test component to consume the *ConfigContext*
const TestConsumer = () => {
  const { state, dispatch } = useConfig(); // Use the correct hook

  const toggleConsole = () => {
    dispatch({ type: 'TOGGLE_OPS_CONSOLE' });
  };

  return (
    <div>
      <div data-testid="console-open">{String(state.isOpsConsoleOpen)}</div>
      <button onClick={toggleConsole}>Toggle Console</button>
    </div>
  );
};

// Helper to render the component with the *ConfigProvider*
const renderWithProvider = (ui: ReactNode) => {
  return render(<ConfigProvider>{ui}</ConfigProvider>);
};

describe('ConfigContext', () => {
  // This test assumes 'isOpsConsoleOpen' is false in your default config
  it('should provide default initial state for isOpsConsoleOpen', () => {
    renderWithProvider(<TestConsumer />);
    expect(screen.getByTestId('console-open')).toHaveTextContent('false');
  });

  it('should toggle isOpsConsoleOpen via the TOGGLE_OPS_CONSOLE action', () => {
    renderWithProvider(<TestConsumer />);

    // Check default state
    expect(screen.getByTestId('console-open')).toHaveTextContent('false');

    // First toggle (to true)
    act(() => {
      screen.getByText('Toggle Console').click();
    });
    expect(screen.getByTestId('console-open')).toHaveTextContent('true');

    // Second toggle (back to false)
    act(() => {
      screen.getByText('Toggle Console').click();
    });
    expect(screen.getByTestId('console-open')).toHaveTextContent('false');
  });
});