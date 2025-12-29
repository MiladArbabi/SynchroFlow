//apps/frontend/src/wiring/specterAhaAdapter.ts
import { useUiEvents } from 'analytics/useUiEvents';
import { setFt1ChecklistFocus } from 'activation/ft1ChecklistFocus';
import { openFt1Checklist } from 'activation/openFt1Checklist';
import type { SpecterUiIntent } from '@lasyncro/specter';

export function useSpecterAhaAdapter() {
  const { emit } = useUiEvents();

  return (intent: SpecterUiIntent) => {
    if (intent.type === 'START_ONBOARDING') {
      console.debug('[SpecterAhaAdapter] START_ONBOARDING', intent);

      // 1️⃣ Set checklist focus
      setFt1ChecklistFocus({
        moduleId: 'specter',
        taskId: intent.taskId,
      });

      // 2️⃣ Open checklist drawer
      openFt1Checklist();

      // 3️⃣ Emit analytics
      emit({
        event: 'ui.intent',
        payload: {
          action: 'start_onboarding',
          surface: 'specter_aha',
          moduleId: 'specter',
          taskId: intent.taskId,
        },
      });
    }
  };
}
