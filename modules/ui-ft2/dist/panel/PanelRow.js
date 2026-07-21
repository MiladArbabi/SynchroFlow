import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
export function PanelRow({ label, value, diff, diffTone = 'neutral', diffPosition = 'right', }) {
    const hasDiff = diff !== undefined;
    return (_jsxs(RowContainer, { hasDiff: hasDiff, diffPosition: diffPosition, "data-ft2-panel-row": true, children: [_jsx(Label, { children: label }), _jsx(Value, { children: value ?? '—' }), hasDiff && (_jsx(Diff, { "data-diff-tone": diffTone, children: diff ?? '—' }))] }));
}
/**
 * Styled primitives
 */
const RowContainer = styled('div', {
    shouldForwardProp: (prop) => prop !== 'hasDiff' && prop !== 'diffPosition',
})(({ hasDiff, diffPosition }) => ({
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
//# sourceMappingURL=PanelRow.js.map