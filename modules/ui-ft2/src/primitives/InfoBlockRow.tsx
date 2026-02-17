// InfoBlockRow.tsx
// ----------------
// FT2-safe row primitive.
// Observational only.

import {
  InfoBlockRowContainer,
  InfoBlockRowLabel,
  InfoBlockRowValue,
  InfoBlockRowDiff,
} from './InfoBlock.styles.js';

export type InfoBlockDiffTone = 'up' | 'down' | 'neutral';
export type InfoBlockDiffPosition = 'left' | 'right';

export interface InfoBlockRowProps {
  label: string;
  value: string | number | null;
  diff?: string | null;
  diffTone?: InfoBlockDiffTone;
  diffPosition?: InfoBlockDiffPosition;
}

export function InfoBlockRow({
  label,
  value,
  diff,
  diffTone = 'neutral',
  diffPosition = 'right',
}: InfoBlockRowProps) {
  return (
    <InfoBlockRowContainer
        hasDiff={diff !== undefined}
        diffPosition={diffPosition}
    >
      <InfoBlockRowLabel>{label}</InfoBlockRowLabel>
      <InfoBlockRowValue>{value ?? '—'}</InfoBlockRowValue>

      {diff !== undefined && (
        <InfoBlockRowDiff data-diff-tone={diffTone}>
          {diff ?? '—'}
        </InfoBlockRowDiff>
      )}
    </InfoBlockRowContainer>
  );
}
