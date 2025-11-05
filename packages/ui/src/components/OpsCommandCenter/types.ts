// packages/ui/src/components/OpsCommandCenter/types.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
// We will expand these types in future tickets
// (e.g., for NLP, Proactive, etc.)
import { OpsContextState } from 'contexts/OpsContext';
import { NavigateFunction } from 'react-router-dom';

// --- Core Action Types ---

export type CommandResult = {
  success: boolean;
  message: string;
};

export type OpsActionCategory = 'safe' | 'destructive' | 'analytical';

export interface OpsAction {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  icon?: string;
  category: OpsActionCategory;
  
  // Context rules
  context: {
    pages: string[]; // e.g., ['dashboard', 'orders']
    needsEntity?: boolean;
    requiredPermissions?: string[];
  };
  
  // Execution
  execute: (
    context: OpsContextState,
    navigate: NavigateFunction, // Add navigate function
  ) => Promise<CommandResult>;
  
  // Safety (for future tickets)
  preview?: (context: OpsContextState) => Promise<any>;
  confirmationMessage?: string | ((previewData: any) => string);
  undoable?: boolean;
}

// --- LAYER 3: PROACTIVE INSIGHT TYPES ---

/**
 * This defines the structure of the *suggested action* that the
 * frontend will build and show to the user.
 */
export interface SuggestedAction {
  label: string;
  description?: string;
  action: OpsAction; // It re-uses our core OpsAction!
  icon?: string;
  primary?: boolean;
}

/**
 * This defines the shape of the data payload we expect to
 * receive from the backend SSE "Kore Comlink".
 */
export interface ProactiveInsight {
  id: string;
  type: 'alert' | 'recommendation' | 'opportunity' | 'celebration';
  title: string;
  message: string;
  urgency: 'high' | 'medium' | 'low';
  timestamp: number;
  source: 'inventory' | 'orders' | 'customers' | 'marketing' | 'shipping';
  status: 'new' | 'viewed' | 'acted-upon' | 'dismissed';

  // This is the raw data from the backend. We will
  // use this to *build* the 'SuggestedAction' objects.
  actionPayload: {
    actionId: string; // e.g., 'nav-order-detail'
    context: Record<string, any>; // e.g., { orderId: 123 }
  }[];
}