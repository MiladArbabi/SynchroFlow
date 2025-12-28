// apps/frontend/src/analytics/useUiEvents.ts

/**
 * Generic UI event emitter.
 *
 * HARD RULES:
 * - No lifecycle knowledge
 * - No entitlement knowledge
 * - No vendor lock-in (PostHog, GA, etc.)
 * - Payloads must be stable and minimal
 */

export interface UiEvent {
  event: 'ui.intent';
  payload: {
    action: string;
    surface: string;
    moduleId?: string;
    taskId?: string;
  };
}

export function useUiEvents() {
  return {
    emit(event: UiEvent) {
      // Intentionally abstract.
      // Wiring to PostHog / Segment / etc happens at adapter layer later.
      if (import.meta.env.DEV) {
        console.debug('[ui-event]', event);
      }
    },
  };
}