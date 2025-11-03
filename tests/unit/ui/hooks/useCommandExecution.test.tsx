//tests/unit/ui/hooks/useCommandExecution.test.tsx
import { renderHook, act } from '@testing-library/react';
import { useToast } from 'contexts/ToastContext';
import { useOpsContext } from 'contexts/OpsContext';
import { OpsAction } from 'components/OpsCommandCenter/types';
// This import will fail
import { useCommandExecution } from 'components/OpsCommandCenter/hooks/useCommandExecution';

// Mock our dependencies
jest.mock('contexts/ToastContext');
jest.mock('contexts/OpsContext');

// Create typed mocks
const mockUseToast = useToast as jest.Mock;
const mockUseOpsContext = useOpsContext as jest.Mock;
const mockToastShow = jest.fn();

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
    });
  });

  it('should set isExecuting to true during execution and false after', async () => {
    const { result } = renderHook(() => useCommandExecution());

    expect(result.current.isExecuting).toBe(false);

    let promise: Promise<any>;
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
});