/* eslint-disable react-refresh/only-export-components */
import React, {
  createContext,
  useContext,
  useReducer,
  ReactNode,
  useMemo,
} from 'react';

// --- TYPES ---

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextState {
  toasts: ToastMessage[];
}

type ToastAction =
  | { type: 'ADD_TOAST'; payload: ToastMessage }
  | { type: 'REMOVE_TOAST'; payload: string }; // payload is the id

// --- NEW: Options for the show function ---
interface ToastOptions {
  duration?: number;
}

interface IToastContext {
  state: ToastContextState;
  show: (message: string, type: ToastType, options?: ToastOptions) => void;
}

// --- INITIAL STATE & REDUCER ---

const initialState: ToastContextState = {
  toasts: [],
};

const toastReducer = (
  state: ToastContextState,
  action: ToastAction,
): ToastContextState => {
  switch (action.type) {
    case 'ADD_TOAST':
      return {
        ...state,
        toasts: [...state.toasts, action.payload],
      };
    case 'REMOVE_TOAST':
      return {
        ...state,
        toasts: state.toasts.filter((toast) => toast.id !== action.payload),
      };
    default:
      return state;
  }
};

// --- CONTEXT & PROVIDER ---

const ToastContext = createContext<IToastContext | undefined>(undefined);

const DEFAULT_TOAST_TIMEOUT = 5000; // Use 5000ms as the default

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(toastReducer, initialState);

  // Memoized 'show' function
  const show = useMemo(
    () =>
      (message: string, type: ToastType, options?: ToastOptions) => {
        const id = crypto.randomUUID();
        dispatch({ type: 'ADD_TOAST', payload: { id, message, type } });

        // --- Use custom duration or default ---
        const duration = options?.duration || DEFAULT_TOAST_TIMEOUT;

        // Set a timer to automatically remove the toast
        setTimeout(() => {
          dispatch({ type: 'REMOVE_TOAST', payload: id });
        }, duration);
      },
    [],
  );

  const value = useMemo(() => ({ state, show }), [state, show]);

  return (
    <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
  );
};

// --- HOOK ---

export const useToast = () => {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};