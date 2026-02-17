/**
 * EpistemicInfoBlockRow
 * --------------------
 * Canonical FT2 row for epistemic values.
 *
 * Responsibilities:
 * - Render epistemic value display
 * - Apply epistemic tone emphasis
 * - Attach tooltip when provided
 * - Remain visually minimal and non-judgmental
 *
 * Non-responsibilities:
 * - NO epistemic reasoning
 * - NO value formatting
 * - NO business semantics
 *
 * This component is the ONLY place where:
 * - tone
 * - icon
 * - tooltip
 * are interpreted visually.
 */

import { InfoBlockRow } from './InfoBlockRow.js';
import type { EpistemicVisualSignal } from '../primitives/epistemic.types.js';
import { epistemicToneTokens } from '../layout/tokens.js';

export interface EpistemicInfoBlockRowProps {
  label: string;
  signal: EpistemicVisualSignal;
}

export function EpistemicInfoBlockRow({
  label,
  signal,
}: EpistemicInfoBlockRowProps) {
  const emphasis =
    epistemicToneTokens[signal.tone]?.emphasis ?? 'default';

  return (
    <div
      title={signal.tooltip}
      data-epistemic-tone={signal.tone}
      data-epistemic-emphasis={emphasis}
    >
      <InfoBlockRow
        label={label}
        value={signal.display}
      />
    </div>
  );
}

/**
 * Epistemic Debt
 * --------------
 * Rows rendered with:
 * - tone: 'warning' or 'error'
 * represent epistemic debt.
 *
 * This is NOT failure.
 * This is the system being honest about its limits.
 *
 * Future phases may:
 * - aggregate epistemic debt
 * - surface trust summaries
 * - drive corrective workflows
 */
