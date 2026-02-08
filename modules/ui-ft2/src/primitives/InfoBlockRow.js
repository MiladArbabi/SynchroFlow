import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// InfoBlockRow.tsx
// ----------------
// FT2-safe row primitive.
// Observational only.
import { InfoBlockRowContainer, InfoBlockRowLabel, InfoBlockRowValue, InfoBlockRowDiff, } from './InfoBlock.styles';
export function InfoBlockRow({ label, value, diff, diffTone = 'neutral', diffPosition = 'right', }) {
    return (_jsxs(InfoBlockRowContainer, { hasDiff: diff !== undefined, diffPosition: diffPosition, children: [_jsx(InfoBlockRowLabel, { children: label }), _jsx(InfoBlockRowValue, { children: value ?? '—' }), diff !== undefined && (_jsx(InfoBlockRowDiff, { "data-diff-tone": diffTone, children: diff ?? '—' }))] }));
}
//# sourceMappingURL=InfoBlockRow.js.map