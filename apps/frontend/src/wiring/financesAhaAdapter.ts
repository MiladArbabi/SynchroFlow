// apps/frontend/src/wiring/financesAhaAdapter.ts

import { useUiEvents } from 'analytics/useUiEvents';
import { setFt1ChecklistFocus } from 'activation/ft1ChecklistFocus';
import { openFt1Checklist } from 'activation/openFt1Checklist';
import type { FinancesUiIntent } from '@lasyncro/finances';

export function useFinancesAhaAdapter() {
  const { emit } = useUiEvents();

  return (intent: FinancesUiIntent) => {
    if (intent.type === 'START_ONBOARDING') {
      console.debug('[FinancesAhaAdapter] START_ONBOARDING', intent);

      // 1️⃣ Set checklist focus (module + task)
      setFt1ChecklistFocus({
        moduleId: 'finances',
        taskId: intent.taskId,
      });

      // 2️⃣ Open checklist drawer
      openFt1Checklist();

      // 3️⃣ Emit analytics
        emit('ui.intent', {
          action: 'start_onboarding',
          surface: 'finances_aha',
          moduleId: 'finances',
          taskId: intent.taskId,
        })
    }
  }
}
