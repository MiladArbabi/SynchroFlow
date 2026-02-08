import { jsx as _jsx } from "react/jsx-runtime";
// modules/ui-ft2/src/primitives/EpistemicInfoBlockRow.tsx
import { InfoBlockRow } from './InfoBlockRow';
export function EpistemicInfoBlockRow({ label, signal, }) {
    return (_jsx("span", { title: signal.tooltip, children: _jsx(InfoBlockRow, { label: label, value: signal.display }) }));
}
//# sourceMappingURL=EpistemicInfoBlockRow.js.map