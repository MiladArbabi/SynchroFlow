import React, { ReactNode } from 'react';
import {
  render,
  screen,
  act,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { ToastProvider, useToast } from 'contexts/ToastContext';
import { ToastContainer } from 'components/ToastContainer';

// --- START FIX #1: Mock framer-motion ---
// This makes AnimatePresence and motion.div render their children
// immediately, without any delays or animations.
jest.mock('framer-motion', () => {
  const React = jest.requireActual('react') as typeof import('react');
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    motion: {
      div: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
        ({ children, ...rest }, ref) => (
          <div {...rest} ref={ref}>
            {children}
          </div>
        )
      ),
    },
  };
});
// --- END FIX #1 ---

const TestConsumer = ({ onShow }: { onShow?: () => void }) => {
  const { show } = useToast();
  return (
    <div>
      <button
        onClick={() => {
          show('Success!', 'success');
          onShow?.();
        }}
      >
        Show Success
      </button>
      <button
        onClick={() => {
          show('Error!', 'error');
          onShow?.();
        }}
      >
        Show Error
      </button>
    </div>
  );
};

const renderWithProvider = (ui: ReactNode) => {
  return render(
    <ToastProvider>
      {ui}
      <ToastContainer />
    </ToastProvider>
  );
};

describe('ToastContext', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('should not show any toasts by default', () => {
    renderWithProvider(<TestConsumer />);
    const container = screen.getByTestId('container');
    expect(container).toBeEmptyDOMElement();
  });

  it('should show a toast when toast.show() is called', () => {
    renderWithProvider(<TestConsumer />);
    act(() => {
      fireEvent.click(screen.getByText('Show Success'));
    });

    // --- START FIX #2: Make assertions more robust ---
    // Check for the message itself
    expect(screen.getByText('Success!')).toBeInTheDocument();
    // Check for the *title* associated with the 'success' type
    expect(screen.getByText('Success')).toBeInTheDocument(); // This is the AlertTitle
    // --- END FIX #2 ---
  });

  it('should remove the toast after the default timeout', async () => {
    renderWithProvider(<TestConsumer />);
    act(() => {
      fireEvent.click(screen.getByText('Show Error'));
    });
    expect(screen.getByText('Error!')).toBeInTheDocument();

    // Advance timers by the 5000ms default
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    // With framer-motion mocked, waitFor is almost instant
    await waitFor(() => {
      expect(screen.queryByText('Error!')).not.toBeInTheDocument();
    });
  });

  // Additional robust tests
  it('should remove toast after custom duration', async () => {
    const CustomConsumer = () => {
      const { show } = useToast();
      return (
        <button
          onClick={() => show('Custom!', 'info', { duration: 2000 })}
        >
          Show Custom
        </button>
      );
    };
    renderWithProvider(<CustomConsumer />);
    act(() => {
      fireEvent.click(screen.getByText('Show Custom'));
    });
    expect(screen.getByText('Custom!')).toBeInTheDocument();

    // Advance by the custom 2000ms
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      expect(screen.queryByText('Custom!')).not.toBeInTheDocument();
    });
  });

  it('should handle multiple toasts and remove them sequentially', async () => {
    renderWithProvider(<TestConsumer />);
    act(() => {
      fireEvent.click(screen.getByText('Show Success'));
      fireEvent.click(screen.getByText('Show Error'));
    });
    expect(screen.getByText('Success!')).toBeInTheDocument();
    expect(screen.getByText('Error!')).toBeInTheDocument();

    // Advance time
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    await waitFor(() => {
      expect(screen.queryByText('Success!')).not.toBeInTheDocument();
      expect(screen.queryByText('Error!')).not.toBeInTheDocument();
    });
  });
});