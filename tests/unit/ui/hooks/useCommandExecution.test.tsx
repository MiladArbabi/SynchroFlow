//tests/unit/ui/hooks/useCommandExecution.test.tsx
import { renderHook, act } from '@testing-library/react';
import { useNavigate } from 'react-router-dom';
import { useToast } from 'contexts/ToastContext';
import { OpsActionType, useOpsContext } from 'contexts/OpsContext';
import { OpsAction, CommandResult } from 'components/OpsCommandCenter/types';
// This import will fail
import { useCommandExecution } from 'components/OpsCommandCenter/hooks/useCommandExecution';
import { Intent } from 'components/OpsCommandCenter/naturalLanguage/types';

// Mock our dependencies
jest.mock('contexts/ToastContext');
jest.mock('contexts/OpsContext');
jest.mock('react-router-dom', () => ({
  useNavigate: jest.fn(),
}));

// Create typed mocks
const mockUseToast = useToast as jest.Mock;
const mockUseOpsContext = useOpsContext as jest.Mock;
const mockToastShow = jest.fn();
const mockDispatch = jest.fn();
const mockNavigate = jest.fn();

// A successful action
const mockSuccessAction: OpsAction = {
  id: '1',
  name: 'Success Action',
  category: 'safe',
  context: { pages: ['*'] },
  execute: async () => ({ success: true, message: 'It worked!' }),
  keywords: [],
  description: '',
};

// A mock NLP intent
const mockNLPIntent: Intent = {
  name: 'find-orders',
  confidence: 0.9,
  entities: { status: 'pending' },
};

// A mock "search" intent (low confidence)
const mockSearchIntent: Intent = {
  name: 'search',
  confidence: 0.1,
  entities: {},
};

// A failing action
const mockFailAction: OpsAction = {
  id: '2',
  name: 'Fail Action',
  category: 'safe',
  context: { pages: ['*'] },
  execute: async () => {
    throw new Error('It failed!');
  },
  keywords: [],
  description: '',
};

// A permission-required action
const mockPermAction: OpsAction = {
  id: '3',
  name: 'Perm Action',
  category: 'destructive',
  context: { pages: ['*'], requiredPermissions: ['admin:write'] },
  execute: async () => ({ success: true, message: 'Admin action!' }),
  keywords: [],
  description: '',
};

describe('useCommandExecution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Setup the mock implementations
    mockUseToast.mockReturnValue({
      show: mockToastShow,
    });
    mockUseOpsContext.mockReturnValue({
      context: {
        userPermissions: ['user:read'], // Default user has no admin perms
      },
     dispatch: mockDispatch, // Provide the mock dispatch 
    });
    // --- 3. APPLY THE MOCK ---
    (useNavigate as jest.Mock).mockReturnValue(mockNavigate);
  });

  it('should set isExecuting to true during execution and false after', async () => {
    const { result } = renderHook(() => useCommandExecution());

    expect(result.current.isExecuting).toBe(false);

    let promise: Promise<CommandResult | void>;
    act(() => {
      promise = result.current.executeCommand(mockSuccessAction, null);
    });

    expect(result.current.isExecuting).toBe(true);
    await act(async () => {
      await promise;
    });
    expect(result.current.isExecuting).toBe(false);
  });

  it('should call toast.show with success on successful execution', async () => {
    const { result } = renderHook(() => useCommandExecution());

    await act(async () => {
      await result.current.executeCommand(mockSuccessAction, null);
    });

    expect(mockToastShow).toHaveBeenCalledWith('It worked!', 'success');
  });

  it('should call toast.show with error on a failed execution', async () => {
    const { result } = renderHook(() => useCommandExecution());

    await act(async () => {
      // We expect this to throw, so we catch it
      try {
        await result.current.executeCommand(mockFailAction, null);
      } catch (e) {
        // Expected
      }
    });

    expect(mockToastShow).toHaveBeenCalledWith('It failed!', 'error');
  });

  it('should throw an error and show toast if permissions are missing', async () => {
    const { result } = renderHook(() => useCommandExecution());
    let caughtError: any = null;

    await act(async () => {
      try {
        await result.current.executeCommand(mockPermAction, null);
      } catch (e: any) {
        caughtError = e;
      }
    });

    // Check that an error was thrown
    expect(caughtError).not.toBeNull();
    expect(caughtError?.message).toBe('Insufficient permissions');

    // Check that a toast was shown
    expect(mockToastShow).toHaveBeenCalledWith(
      'Insufficient permissions',
      'error',
    );
  });
  // --- ADD THESE NEW TESTS ---
  it('should NOT save to conversation memory for a non-NLP (Layer 1) action', async () => {
    const { result } = renderHook(() => useCommandExecution());

    await act(async () => {
      // Pass 'null' for the intent
      await result.current.executeCommand(mockSuccessAction, null);
    });

    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('should save to conversation memory for a high-confidence NLP action', async () => {
    const { result } = renderHook(() => useCommandExecution());

    await act(async () => {
      await result.current.executeCommand(mockSuccessAction, mockNLPIntent);
    });

    // Check that dispatch was called with the correct action and payload
    expect(mockDispatch).toHaveBeenCalledWith({
      type: OpsActionType.SET_CONVERSATION,
      payload: {
        topic: 'find-orders',
        entities: { status: 'pending' },
        timestamp: expect.any(Number), // Timestamp will be generated, so we check for type
      },
    });
  });

  it('should NOT save to conversation memory for a "search" intent', async () => {
    const { result } = renderHook(() => useCommandExecution());

    await act(async () => {
      await result.current.executeCommand(mockSuccessAction, mockSearchIntent);
    });

    expect(mockDispatch).not.toHaveBeenCalled();
  });
});