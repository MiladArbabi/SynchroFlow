import { useUiEvents } from 'analytics/useUiEvents';
import { setFt1ChecklistFocus } from 'activation/ft1ChecklistFocus';
import { openFt1Checklist } from 'activation/openFt1Checklist';
import type { OrderNexusUiIntent } from '@lasyncro/order-nexus';

export function useOrderNexusAhaAdapter() {
  const { emit } = useUiEvents();

  return (intent: OrderNexusUiIntent) => {
    if (intent.type === 'START_ONBOARDING') {
      console.debug('[OrderNexusAhaAdapter] START_ONBOARDING', intent);

      // 1️⃣ Set checklist focus (module + task)
      setFt1ChecklistFocus({
        moduleId: 'order-nexus',
        taskId: intent.taskId,
      });

      // 2️⃣ Open checklist drawer
      openFt1Checklist();

      // 3️⃣ Emit analytics
      emit({
        event: 'ui.intent',
        payload: {
          action: 'start_onboarding',
          surface: 'order_nexus_aha',
          moduleId: 'order-nexus',
          taskId: intent.taskId,
        },
      });
    }
  };
}
