// apps/frontend/src/wiring/productsAhaAdapter.ts
import { useUiEvents } from 'analytics/useUiEvents';

export function useProductsAhaAdapter() {
  const { emit } = useUiEvents();

  return (intent: { type: 'START_ONBOARDING'; taskId?: string }) => {
    emit({
      event: 'ui.intent',
      payload: {
        action: 'start_onboarding',
        surface: 'products_ft1',
        moduleId: 'products',
        taskId: intent.taskId,
      },
    });
  };
}
