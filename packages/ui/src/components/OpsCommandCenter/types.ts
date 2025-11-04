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