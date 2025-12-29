// modules/finances/src/ui/intents.ts

export type FinancesUiIntent =
  | { 
    type: 'START_ONBOARDING';
    taskId?: string; 
    };
