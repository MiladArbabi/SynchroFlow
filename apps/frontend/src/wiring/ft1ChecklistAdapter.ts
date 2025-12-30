/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/wiring/ft1ChecklistAdapter.ts

/**
 * FT1 Checklist Adapter
 * ---------------------
 * Pure mapping:
 * backend onboarding-readiness snapshot → FT1 checklist view model
 *
 * HARD RULES:
 * - No hooks
 * - No side effects
 * - No UI logic
 * - Backend is source of truth
 */

type BackendTask = {
  id: string;
  label: string;
  complete: boolean;
};

type BackendModule = {
  moduleId: string;
  displayName?: string;
  tasks?: BackendTask[];
};

export function mapFt1Checklist(readinessSnapshot: any) {
  const modules: BackendModule[] = readinessSnapshot?.modules ?? [];

  return {
    modules: modules.map((module) => ({
      moduleId: module.moduleId,
      title: module.displayName ?? module.moduleId,
      tasks: (module.tasks ?? []).map((task) => ({
        id: task.id,
        label: task.label,
        completed: task.complete === true,
      })),
    })),
  };
}