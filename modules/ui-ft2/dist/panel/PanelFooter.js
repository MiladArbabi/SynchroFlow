import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * PanelFooter
 * -----------
 * Interpretation rail for FT2Panel.
 *
 * Replaces InfoBlockFooter.
 *
 * Responsibilities:
 *  - render contextual interpretation lines
 *  - provide visual separation from panel rows
 *
 * No layout logic.
 * No business semantics.
 */
import { styled } from '@mui/material/styles';
export function PanelFooter({ line1, line2 }) {
    return (_jsxs(FooterContainer, { "data-ft2-panel-footer": true, children: [_jsx("div", { children: line1 }), line2 && _jsx("div", { children: line2 })] }));
}
/**
 * Styled primitive
 */
const FooterContainer = styled('div')({
    padding: '8px 14px',
    background: 'var(--ft2-surface-bg)',
    borderTop: '1px solid var(--ft2-surface-divider)',
    fontFamily: '"IBM Plex Mono", monospace',
    fontSize: 10,
    lineHeight: '14px',
    color: 'var(--ft2-text-muted)',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
});
//# sourceMappingURL=PanelFooter.js.map