// modules/shared/src/contracts/activation.ts

export type ActivationVerdict =
  | {
      verdict: 'BLOCKED';
      reason: 'NOT_CONNECTED';
    }
  | {
      verdict: 'INTEGRATION_COMPLETE_NOT_READY';
      blockingModules?: string[];
    }
  | {
      verdict: 'ACTIVE';
      activatedModules: string[];
    };
