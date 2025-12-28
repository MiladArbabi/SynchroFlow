// apps/frontend/src/activation/ft1ChecklistFocus.ts

export type Ft1ChecklistFocus = {
  moduleId: string;
  taskId?: string;
};

let focus: Ft1ChecklistFocus | null = null;

/**
 * Sets one-shot FT1 checklist focus.
 * Consumed by Ft1ChecklistShell on mount.
 */
export function setFt1ChecklistFocus(next: Ft1ChecklistFocus) {
  focus = next;
}

export function clearFt1ChecklistFocus() {
  focus = null;
}

/**
 * Consumes and clears focus (one-time).
 */
export function consumeFt1ChecklistFocus(): Ft1ChecklistFocus | null {
  const current = focus;
  focus = null;
  return current;
}
