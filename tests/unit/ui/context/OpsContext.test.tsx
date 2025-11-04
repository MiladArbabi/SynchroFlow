// tests/unit/ui/context/OpsContext.test.tsx
import { ReactNode } from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { 
  OpsContextProvider, 
  useOpsContext, 
  OpsActionType,
  KoreConversation 
} from 'contexts/OpsContext';

// A simple test component to consume the context
const TestConsumer = () => {
  const { context, dispatch } = useOpsContext();

  const setPage = (page: string, entityId?: string) => {
    dispatch({
      type: OpsActionType.SET_CONTEXT,
      payload: { page, entityId },
    });
  };

  const setPerms = (perms: string[]) => {
    dispatch({
      type: OpsActionType.SET_PERMISSIONS,
      payload: perms,
    });
  };

  const setConvo = () => {
    const mockConvo: KoreConversation = {
      topic: 'find-orders',
      entities: { status: 'pending' },
      timestamp: 12345,
    };
    dispatch({ type: OpsActionType.SET_CONVERSATION, payload: mockConvo });
  };

  const clearConvo = () => {
    dispatch({ type: OpsActionType.CLEAR_CONVERSATION });
  };

  return (
    <div>
      <div data-testid="page">{context.page}</div>
      <div data-testid="entity">{context.entityId}</div>
      <div data-testid="perms">{context.userPermissions.join(',')}</div>
      {/* Add a simple way to see conversation state */}
      <div data-testid="convo-topic">
        {context.conversation?.topic || 'null'}
      </div>
      <button onClick={() => setPage('orders', '123')}>Set Page</button>
      <button onClick={() => setPerms(['admin', 'refund'])}>Set Perms</button>
      <button onClick={setConvo}>Set Conversation</button>
      <button onClick={clearConvo}>Clear Conversation</button>
    </div>
  );
};

// Helper to render the component with the provider
const renderWithProvider = (ui: ReactNode) => {
  return render(<OpsContextProvider>{ui}</OpsContextProvider>);
};

describe('OpsContext', () => {
  it('should provide default initial state', () => {
    renderWithProvider(<TestConsumer />);
    expect(screen.getByTestId('page')).toHaveTextContent('dashboard');
    expect(screen.getByTestId('entity')).toBeEmptyDOMElement();
    expect(screen.getByTestId('perms')).toBeEmptyDOMElement();
    expect(screen.getByTestId('convo-topic')).toHaveTextContent('null');
  });

  it('should update context state via the SET_CONTEXT action', () => {
    renderWithProvider(<TestConsumer />);

    act(() => {
      screen.getByText('Set Page').click();
    });

    expect(screen.getByTestId('page')).toHaveTextContent('orders');
    expect(screen.getByTestId('entity')).toHaveTextContent('123');
  });

  it('should update permissions via the SET_PERMISSIONS action', () => {
    renderWithProvider(<TestConsumer />);

    act(() => {
      screen.getByText('Set Perms').click();
    });

    expect(screen.getByTestId('perms')).toHaveTextContent('admin,refund');
  });
});

describe('OpsContext: Conversation State', () => {
  it('should set the conversation state', () => {
    renderWithProvider(<TestConsumer />);

    act(() => {
      screen.getByText('Set Conversation').click();
    });

    expect(screen.getByTestId('convo-topic')).toHaveTextContent('find-orders');
  });

  it('should clear the conversation state', () => {
    renderWithProvider(<TestConsumer />);

    // Set it first, then clear it
    act(() => screen.getByText('Set Conversation').click());
    expect(screen.getByTestId('convo-topic')).toHaveTextContent('find-orders');

    act(() => screen.getByText('Clear Conversation').click());
    expect(screen.getByTestId('convo-topic')).toHaveTextContent('null');
  });
});