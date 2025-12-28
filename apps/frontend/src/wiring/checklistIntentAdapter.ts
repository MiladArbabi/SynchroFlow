//apps/frontend/src/wiring/checklistIntentAdapter.ts
import { useUiEvents } from 'analytics/useUiEvents';
import type { ChecklistUiIntent } from '@lasyncro/shared/ui-contracts';

export function useChecklistIntentAdapter() {
  const { emit } = useUiEvents();

  return (intent: ChecklistUiIntent) => {
    if (intent.type === 'TASK_CLICK') {
      emit({
        event: 'ui.intent',
        payload: {
          action: `task_click:${intent.taskId}`,
          surface: 'ft1_checklist',
          moduleId: intent.moduleId,
        },
      });
    }
  };
}
