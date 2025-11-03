import { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
// --- FIX #1: Import the *raw context* as well ---
import {
  OpsContext,
  OpsContextState,
  initialState,
  IOpsContext,
} from 'contexts/OpsContext';
// This import is for the hook we are testing
import { useOpsCommands } from 'components/OpsCommandCenter/hooks/useOpsCommands';
// We'll mock the command definitions and the search hook (which we know exists)
import * as commandDefinitions from 'components/OpsCommandCenter/commandDefinitions';
import * as searchHook from 'components/OpsCommandCenter/hooks/useNativeSearch';

// Mock our dependencies
jest.mock('components/OpsCommandCenter/commandDefinitions');
jest.mock('components/OpsCommandCenter/hooks/useNativeSearch');

const mockUseNativeSearch = jest.spyOn(searchHook, 'useNativeSearch');
const mockAllActions = [
  { id: '1', name: 'Global Action', context: { pages: ['*'] } },
  { id: '2', name: 'Dashboard Action', context: { pages: ['dashboard'] } },
  { id: '3', name: 'Orders Action', context: { pages: ['orders'] } },
  {
    id: '4',
    name: 'Order Entity Action',
    context: { pages: ['orders'], needsEntity: true },
  },
];

// --- FIX #2: This helper now uses OpsContext.Provider to pass a mock value ---
const renderHookWithProvider = (
  searchQuery: string,
  contextState: Partial<OpsContextState> = {},
) => {
  // Create the mock context value
  const mockContext: IOpsContext = {
    context: { ...initialState, ...contextState },
    dispatch: () => {}, // We don't test dispatch in this hook, so a mock is fine
  };

  const wrapper = ({ children }: { children: ReactNode }) => (
    <OpsContext.Provider value={mockContext}>
      {children}
    </OpsContext.Provider>
  );

  return renderHook(() => useOpsCommands(searchQuery), { wrapper });
};

describe('useOpsCommands', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (commandDefinitions as any).ALL_ACTIONS = mockAllActions;
    
    // --- FIX #3: Add 'any' type to the mock implementation ---
    mockUseNativeSearch.mockImplementation((items: any) => items);
  });

  it('should return all global and page-specific actions when query is empty', () => {
    const { result } = renderHookWithProvider('', { page: 'dashboard' });

    expect(result.current.length).toBe(2);
    expect(result.current[0].id).toBe('1');
    expect(result.current[1].id).toBe('2');
  });

  it('should not return entity-specific actions if no entity is present', () => {
    const { result } = renderHookWithProvider('', { page: 'orders' });

    expect(result.current.length).toBe(2);
    expect(result.current[0].id).toBe('1');
    expect(result.current[1].id).toBe('3');
  });

  it('should return entity-specific actions when an entity is present', () => {
    const { result } = renderHookWithProvider('', {
      page: 'orders',
      entityId: '123',
    });

    expect(result.current.length).toBe(3);
    expect(result.current[0].id).toBe('1');
    expect(result.current[1].id).toBe('3');
    expect(result.current[2].id).toBe('4');
  });

  it('should pass the context-filtered list to useNativeSearch when query is present', () => {
    mockUseNativeSearch.mockReturnValue([mockAllActions[1]]);

    const { result } = renderHookWithProvider('dash', { page: 'dashboard' });

    const expectedFilteredList = [mockAllActions[0], mockAllActions[1]];
    expect(mockUseNativeSearch).toHaveBeenCalledWith(
      expectedFilteredList,
      'dash',
      ['name', 'keywords', 'description'], // This should match the keys in the hook
    );

    expect(result.current.length).toBe(1);
    expect(result.current[0].id).toBe('2');
  });
});