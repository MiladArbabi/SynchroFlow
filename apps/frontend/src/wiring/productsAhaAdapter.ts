// apps/frontend/src/wiring/productsAhaAdapter.ts
import { useUiEvents } from 'analytics/useUiEvents';
import { openFt1Checklist } from 'activation/openFt1Checklist';

export function useProductsAhaAdapter() {
  const { emit } = useUiEvents();

  return (intent: { 
    type: 'START_ONBOARDING'; 
    taskId?: string 
  }) => {
    // 1. Emit analytics / intent signal
    emit({
      event: 'ui.intent',
      payload: {
        action: 'start_onboarding',
        surface: 'products_ft1',
        moduleId: 'products',
        taskId: intent.taskId,
      },
    });

    // 2. Open the FT1 checklist drawer
    openFt1Checklist();
  };
}
