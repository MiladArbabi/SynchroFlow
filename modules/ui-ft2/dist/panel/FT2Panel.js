import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * FT2Panel
 * --------
 * Unified panel primitive for FT2 dashboards.
 *
 *
 * Panel owns:
 *
 *  - visual surface
 *  - title header
 *  - padding
 *  - trust boundary
 *  - row container
 *
 * Layout participation:
 *
 * Panels implement the FT2Row span contract.
 *
 *   <FT2Row>
 *     <FT2Panel span={1}/>
 *     <FT2Panel span={2}/>
 *   </FT2Row>
 *
 * This file intentionally does NOT depend on InfoBlock
 * to prevent reintroducing the dual container architecture.
 */
import { Paper, Box } from '@mui/material';
import { FT2_TOKENS } from '../layout/ft2.tokens.js';
import { PanelHeader } from './PanelHeader.js';
export function FT2Panel({ id, title, children, span = 1, trustTone, }) {
    return (_jsxs(Paper, { id: id, elevation: 0, "data-ft2-panel": true, "data-ft2-panel-span": span, "data-ft2-trust": trustTone ?? 'unknown', sx: {
            width: '100%',
            height: '100%',
            /**
             * Panels must not shrink below the
             * minimum width required by action buttons.
             *
             * This prevents UI corruption when
             * the viewport becomes too small.
             */
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            backgroundColor: FT2_TOKENS.surface.background,
            /**
             * Structural edge
             * ---------------
             * Ensures panels remain visually separated
             * from page background even when shadows
             * are subtle in certain themes.
             */
            border: '1px solid var(--ft2-surface-divider)',
            boxShadow: FT2_TOKENS.surfaceShadow.default,
            borderLeft: trustTone
                ? `3px solid ${FT2_TOKENS.trustTone[trustTone]}`
                : 'none',
        }, children: [title && _jsx(PanelHeader, { title: title }), _jsx(Box, { "data-ft2-panel-body": true, sx: {
                    flex: 1,
                    minHeight: 0,
                    /**
                     * CONTROL TOWER CONTENT RULE
                     * --------------------------
                     * Panel content must never expand the panel height.
                     *
                     * When content exceeds available space inside a
                     * deterministic FT2 row, scrolling must occur
                     * within the panel body instead of stretching
                     * the layout.
                     */
                    overflowY: 'auto',
                    px: FT2_TOKENS.surfacePadding.standard / 8,
                    pb: FT2_TOKENS.surfacePadding.standard / 8,
                    display: 'flex',
                    flexDirection: 'column',
                }, children: children })] }));
}
//# sourceMappingURL=FT2Panel.js.map