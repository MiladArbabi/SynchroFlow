/**
 * IMPORTANT EPISTEMIC RULE
 * ------------------------
 * After Phase C3:
 * - `EpistemicValue.state` is the ONLY discriminator
 * - `value === null` must NEVER be used for epistemic branching
 *
 * Violating this rule will cause compile-time failure by design.
 */

import type { EpistemicValue } from '@lasyncro/epistemic';
import type { EpistemicVisualSignal } from '@lasyncro/ui-ft2';

export type EpistemicRenderResult = {
  display: string | null;
  tooltip?: string;
};

/**
 * renderEpistemicMoney
 * --------------------
 * Epistemic → Visual projection.
 *
 * HARD RULES:
 * - Accepts ONLY valid EpistemicValue<number>
 * - Assumes epistemic invariants are already satisfied
 * - Performs NO business logic
 * - Performs NO epistemic reasoning
 *
 * If this function compiles, the epistemic contract is intact.
 */
export function renderEpistemicMoney(
  value: EpistemicValue<number>
): EpistemicVisualSignal {

  switch (value.state) {
  case 'KNOWN': {
    const formatted = Number(value.value.toFixed(2));
    return {
      display: `${formatted}`,
      tone: 'neutral',
    };
  }

  case 'INCOMPLETE': {
    const formatted =
      value.value != null
        ? `≈${Number(value.value.toFixed(2))}`
        : '—';

    return {
      display: formatted,
      tooltip:
        value.explanation ??
        (value.completenessRatio != null
          ? `≈${Math.round(value.completenessRatio * 100)}% data coverage`
          : 'Value partially supported'),
      tone: 'warning',
      icon: 'warning',
    };
  }

  case 'UNKNOWN':
    return {
      display: '—',
      tooltip: value.explanation ?? 'Missing required data',
      tone: 'error',
      icon: 'alert',
    };
}

}