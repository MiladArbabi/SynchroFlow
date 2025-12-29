// modules/analytics/src/ui/intents.ts
export type AnalyticsUiIntent =
  | {
      type: 'START_ONBOARDING';
      taskId?: string;
    };
