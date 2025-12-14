/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-refresh/only-export-components */
import React, {
  createContext,
  useContext,
  useReducer,
  ReactNode,
  useMemo,
  useEffect
} from 'react';
import { KoreConversation } from 'components/OpsCommandCenter/naturalLanguage/types';
import { ProactiveInsight } from 'components/OpsCommandCenter/types';

// We'll import these from types.ts in a future ticket
//import { ProactiveInsight, KoreConversation } from 'components/OpsCommandCenter/types';

// --- STATE & TYPES ---

// The core state of the OpsContext
export interface OpsContextState {
  // isOpsConsoleOpen(isOpsConsoleOpen: any): React.ReactNode; // <-- REMOVED
  page: string;
  entityId?: string;
  entityType?: 'order' | 'customer' | 'product';
  userPermissions: string[];
  // --- ADD conversation TO STATE ---
  conversation: KoreConversation | null;
  proactiveInsights: ProactiveInsight[];
}

// All possible actions our reducer can handle
export enum OpsActionType {
  SET_CONTEXT = 'SET_CONTEXT',
  SET_PERMISSIONS = 'SET_PERMISSIONS',
  // --- ADD NEW ACTION TYPES ---
  SET_CONVERSATION = "SET_CONVERSATION",
  CLEAR_CONVERSATION = "CLEAR_CONVERSATION",
  // --- ADD NEW INSIGHT ACTIONS ---
  ADD_INSIGHT = 'ADD_INSIGHT',
  UPDATE_INSIGHT_STATUS = 'UPDATE_INSIGHT_STATUS',
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
  | { type: OpsActionType.SET_PERMISSIONS; payload: string[] }
// --- 4. ADD NEW ACTION PAYLOADS ---
  | { type: OpsActionType.SET_CONVERSATION; payload: KoreConversation | null }
  | { type: OpsActionType.CLEAR_CONVERSATION }
  // --- 5. ADD NEW INSIGHT PAYLOADS ---
  | { type: OpsActionType.ADD_INSIGHT; payload: ProactiveInsight }
  | { type: OpsActionType.UPDATE_INSIGHT_STATUS; payload: { id: string; status: 'viewed' | 'acted-upon' | 'dismissed' } };


export const initialState: OpsContextState = {
  page: 'dashboard', // Default page context
  entityId: undefined,
  entityType: undefined,
  userPermissions: [],
  conversation: null,
  proactiveInsights: [],
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
    // --- 6. ADD NEW REDUCER CASES ---
    case OpsActionType.SET_CONVERSATION:
      return {
        ...state,
        conversation: action.payload,
      };
      case OpsActionType.CLEAR_CONVERSATION:
      return {
        ...state,
        conversation: null,
      };
    case OpsActionType.ADD_INSIGHT:
      // Prevent duplicates
      if (state.proactiveInsights.find(i => i.id === action.payload.id)) {
        return state;
      }
      return {
        ...state,
        // Add new insights to the top
        proactiveInsights: [action.payload, ...state.proactiveInsights],
      };
    case OpsActionType.UPDATE_INSIGHT_STATUS:
      return {
        ...state,
        proactiveInsights: state.proactiveInsights.map(insight =>
          insight.id === action.payload.id
            ? { ...insight, status: action.payload.status }
            : insight
        )
      };
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

  // --- 8. ADD THE "KORE COMLINK" (SSE LISTENER) ---
  useEffect(() => {
    /* console.log('[Kore Comlink] Attempting to connect to SSE...'); */
    // TODO: Add auth token to this URL
    const eventSource = new EventSource('/api/v1/kore/subscribe');

    eventSource.onopen = () => {
      /* console.log('[Kore Comlink] SSE Connection Established.'); */
    };

    // Listen for our custom "insight" event
    eventSource.addEventListener('insight', (event) => {
      try {
        const insight = JSON.parse(event.data) as ProactiveInsight;
        /* console.log(`[Kore Comlink] Received insight: ${insight.title}`); */
        dispatch({ type: OpsActionType.ADD_INSIGHT, payload: insight });
      } catch (error) {
        /* console.error('[Kore Comlink] Failed to parse insight event', error); */
      }
    });

    eventSource.onerror = (err) => {
      /* console.error('[Kore Comlink] SSE Error:', err); */
      eventSource.close();
      // We can add retry logic here later
    };

    // Clean up the connection on unmount
    return () => {
      /* console.log('[Kore Comlink] Closing SSE Connection.'); */
      eventSource.close();
    };
  }, []); // Runs once on app load

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