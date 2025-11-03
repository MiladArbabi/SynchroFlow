/* eslint-disable react-refresh/only-export-components */
import React, {
  createContext,
  useContext,
  useReducer,
  ReactNode,
  useMemo,
} from 'react';

// We'll import these from types.ts in a future ticket
// import { ProactiveInsight, KoreConversation } from 'components/OpsCommandCenter/types';

// --- STATE & TYPES ---

// The core state of the OpsContext
export interface OpsContextState {
  // isOpsConsoleOpen(isOpsConsoleOpen: any): React.ReactNode; // <-- REMOVED
  page: string;
  entityId?: string;
  entityType?: 'order' | 'customer' | 'product';
  userPermissions: string[];
  // --- Placeholders for future layers ---
  // conversation: KoreConversation | null;
  // proactiveInsights: ProactiveInsight[];
}

// All possible actions our reducer can handle
export enum OpsActionType {
  SET_CONTEXT = 'SET_CONTEXT',
  SET_PERMISSIONS = 'SET_PERMISSIONS',
  // TOGGLE_OPS_CONSOLE = "TOGGLE_OPS_CONSOLE", // <-- REMOVED (This is in ConfigContext)
  // --- Placeholders for future layers ---
  // SET_CONVERSATION = 'SET_CONVERSATION',
  // CLEAR_CONVERSATION = 'CLEAR_CONVERSATION',
  // ADD_INSIGHT = 'ADD_INSIGHT',
  // UPDATE_INSIGHT_STATUS = 'UPDATE_INSIGHT_STATUS',
}

// The action payload structure
export type OpsAction =
  | {
      type: OpsActionType.SET_CONTEXT;
      payload: {
        page: string;
        entityId?: string;
        entityType?: 'order' | 'customer' | 'product';
      };
    }
  | {
      type: OpsActionType.SET_PERMISSIONS;
      payload: string[];
    };
// | { type: OpsActionType.SET_CONVERSATION; payload: KoreConversation | null }
// | { type: OpsActionType.CLEAR_CONVERSATION }
// | { type: OpsActionType.ADD_INSIGHT; payload: ProactiveInsight }
// | { type: OpsActionType.UPDATE_INSIGHT_STATUS; payload: { id: string; status: 'viewed' | 'acted-upon' | 'dismissed' } };

// --- INITIAL STATE ---

export const initialState: OpsContextState = {
  page: 'dashboard', // Default page context
  entityId: undefined,
  entityType: undefined,
  userPermissions: [],
  // isOpsConsoleOpen: false, // <-- REMOVED
  // conversation: null,
  // proactiveInsights: [],
};

// --- REDUCER ---

export const opsReducer = (
  state: OpsContextState,
  action: OpsAction,
): OpsContextState => {
  switch (action.type) {
    case OpsActionType.SET_CONTEXT:
      return {
        ...state,
        page: action.payload.page,
        entityId: action.payload.entityId,
        entityType: action.payload.entityType,
      };
    case OpsActionType.SET_PERMISSIONS:
      return {
        ...state,
        userPermissions: action.payload,
      };
    // <-- REMOVED TOGGLE_OPS_CONSOLE CASE
    default:
      return state;
  }
};

// --- CONTEXT & PROVIDER ---

export interface IOpsContext {
  context: OpsContextState;
  dispatch: React.Dispatch<OpsAction>;
}

export const OpsContext = createContext<IOpsContext>({
  context: initialState,
  dispatch: () => null,
});

export const OpsContextProvider = ({ children }: { children: ReactNode }) => {
  const [context, dispatch] = useReducer(opsReducer, initialState);

  // Memoize the context value to prevent unnecessary re-renders
  const value = useMemo(() => ({ context, dispatch }), [context]);

  return <OpsContext.Provider value={value}>{children}</OpsContext.Provider>;
};

// --- HOOK ---

export const useOpsContext = () => {
  const context = useContext(OpsContext);
  if (context === undefined) {
    throw new Error('useOpsContext must be used within an OpsContextProvider');
  }
  return context;
};