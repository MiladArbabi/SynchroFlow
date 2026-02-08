// InfoBlock.styles.ts
// -------------------
// Structural styling only.
// No semantics. No logic. No FT2 meaning.
// InfoBlock.styles.ts
// -------------------
// Structural styling only.
// Theme-agnostic via CSS variables.
import { styled } from '@mui/material/styles';
export const InfoBlockContainer = styled('div')({
    width: 350,
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--ft2-infoblock-bg)',
    border: '1px solid var(--ft2-infoblock-border)',
    borderRadius: 12,
    overflow: 'hidden',
    textTransform: 'uppercase',
});
export const InfoBlockHeader = styled('div')({
    padding: '10px 14px',
    background: 'var(--ft2-infoblock-header-bg)',
    borderBottom: '1px solid var(--ft2-infoblock-border)',
    fontFamily: '"IBM Plex Mono", monospace',
    fontSize: 12,
    fontStyle: 'italic',
    fontWeight: 300,
    color: 'var(--ft2-infoblock-header-text)',
});
export const InfoBlockBody = styled('div')({
    display: 'flex',
    flexDirection: 'column',
});
export const InfoBlockRowContainer = styled('div', {
    shouldForwardProp: (prop) => prop !== 'hasDiff' && prop !== 'diffPosition',
})(({ hasDiff, diffPosition }) => ({
    display: 'grid',
    gridTemplateColumns: hasDiff
        ? diffPosition === 'left'
            ? '1fr 36px 48px' // LABEL | DIFF | VALUE
            : '1fr 48px 36px' // LABEL | VALUE | DIFF
        : '1fr 48px', // LABEL | VALUE
    alignItems: 'center',
    padding: '6px 14px',
    fontFamily: '"IBM Plex Mono", monospace',
    fontSize: 12,
    color: 'var(--ft2-infoblock-row-text)',
    borderBottom: '1px solid var(--ft2-infoblock-border)',
    whiteSpace: 'nowrap',
}));
export const InfoBlockRowLabel = styled('div')({
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
});
export const InfoBlockRowValue = styled('div')({
    fontWeight: 500,
    textAlign: 'right',
});
export const InfoBlockRowDiff = styled('div')({
    fontWeight: 700,
    textAlign: 'right',
    color: 'var(--ft2-infoblock-diff-neutral)',
    '&[data-diff-tone="up"]': {
        color: 'var(--ft2-infoblock-diff-up)',
    },
    '&[data-diff-tone="down"]': {
        color: 'var(--ft2-infoblock-diff-down)',
    },
});
export const InfoBlockFooterContainer = styled('div')({
    padding: '8px 14px',
    background: 'var(--ft2-infoblock-footer-bg)',
    borderTop: '1px solid var(--ft2-infoblock-border)',
    fontFamily: '"IBM Plex Mono", monospace',
    fontSize: 10,
    lineHeight: '14px',
    color: 'var(--ft2-infoblock-footer-text)',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
});
//# sourceMappingURL=InfoBlock.styles.js.map