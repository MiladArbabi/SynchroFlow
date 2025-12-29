// apps/frontend/src/wiring/analyticsAhaAdapter.ts
import { useUiEvents } from 'analytics/useUiEvents';
import { setFt1ChecklistFocus } from 'activation/ft1ChecklistFocus';
import { openFt1Checklist } from 'activation/openFt1Checklist';
import type { AnalyticsUiIntent } from '@lasyncro/analytics';

export function useAnalyticsAhaAdapter() {
  const { emit } = useUiEvents();

  return (intent: AnalyticsUiIntent) => {
    if (intent.type === 'START_ONBOARDING') {
      console.debug('[AnalyticsAhaAdapter] START_ONBOARDING', intent);

      // 1️⃣ Set checklist focus
      setFt1ChecklistFocus({
        moduleId: 'analytics',
        taskId: intent.taskId,
      });

      // 2️⃣ Open checklist
      openFt1Checklist();

      // 3️⃣ Emit analytics
      emit({
        event: 'ui.intent',
        payload: {
          action: 'start_onboarding',
          surface: 'analytics_aha',
          moduleId: 'analytics',
          taskId: intent.taskId,
        },
      });
    }
  };
}