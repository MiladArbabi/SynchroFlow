/**
 * PanelRow
 * --------
 * Row primitive for FT2Panel.
 *
 * Replaces InfoBlockRow.
 *
 * Responsibilities:
 *  - label/value rendering
 *  - optional diff indicator
 *
 * No layout logic.
 * No panel semantics.
 *
 * Parent container (FT2Panel) owns layout.
 */

import { styled } from '@mui/material/styles';

export type PanelRowDiffTone = 'up' | 'down' | 'neutral';
export type PanelRowDiffPosition = 'left' | 'right';

export interface PanelRowProps {
  label: string;
  value: string | number | null;
  diff?: string | null;
  diffTone?: PanelRowDiffTone;
  diffPosition?: PanelRowDiffPosition;
}

export function PanelRow({
  label,
  value,
  diff,
  diffTone = 'neutral',
  diffPosition = 'right',
}: PanelRowProps) {

  const hasDiff = diff !== undefined;

  return (
    <RowContainer
      hasDiff={hasDiff}
      diffPosition={diffPosition}
      data-ft2-panel-row
    >
      <Label>{label}</Label>
      <Value>{value ?? '—'}</Value>

      {hasDiff && (
        <Diff data-diff-tone={diffTone}>
          {diff ?? '—'}
        </Diff>
      )}
    </RowContainer>
  );
}

/**
 * Styled primitives
 */

const RowContainer = styled('div', {
  shouldForwardProp: (prop) => prop !== 'hasDiff' && prop !== 'diffPosition',
})<{
  hasDiff?: boolean;
  diffPosition?: 'left' | 'right';
}>(({ hasDiff, diffPosition }) => ({
  display: 'grid',
  width: '100%',

  gridTemplateColumns: hasDiff
  ? diffPosition === 'left'
    ? 'auto 36px auto'
    : 'auto auto 36px'
  : 'auto auto',

  alignItems: 'center',
  padding: '6px 14px',
  columnGap: 8,

  fontFamily: '"IBM Plex Mono", monospace',
  fontSize: 12,

  borderBottom: 'none',
  whiteSpace: 'nowrap',
}));

const Label = styled('div')({
  fontWeight: 600,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

const Value = styled('div')({
  textAlign: 'right',
  fontWeight: 500,
});

const Diff = styled('div')({
  textAlign: 'right',
  fontWeight: 700,
  color: 'var(--ft2-text-muted)',

  '&[data-diff-tone="up"]': {
    color: 'var(--ft2-signal-positive)',
  },

  '&[data-diff-tone="down"]': {
    color: 'var(--ft2-signal-negative)',
  },
});