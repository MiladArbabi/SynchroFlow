// apps/frontend/src/wiring/specterChecklistAdapter.ts

import { setFt1ChecklistFocus } from 'activation/ft1ChecklistFocus';

/**
 * Specter → FT1 checklist focus adapter
 *
 * Responsibility:
 * - Translate Specter UI intents into FT1 checklist focus
 *
 * HARD RULES:
 * - No hooks other than this adapter
 * - No lifecycle logic
 * - No UI logic
 * - No side effects beyond focus
 */

type SpecterUiIntent = {
  type: string;
  taskId?: string;
};

export function useSpecterChecklistAdapter() {
  return (intent: SpecterUiIntent) => {
    if (intent.type !== 'START_ONBOARDING') return;

    setFt1ChecklistFocus({
      moduleId: 'specter',
      taskId: intent.taskId,
    });
  };
}