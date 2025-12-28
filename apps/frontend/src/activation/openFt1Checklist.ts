// apps/frontend/src/activation/openFt1Checklist.ts

/**
 * Opens the FT1 checklist drawer.
 *
 * UI-only side effect.
 * No lifecycle knowledge.
 * No routing.
 */
export function openFt1Checklist() {
  window.dispatchEvent(
    new CustomEvent('ft1-checklist:open')
  );
}
