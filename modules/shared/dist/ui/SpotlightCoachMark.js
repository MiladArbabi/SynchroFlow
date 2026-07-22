import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// modules/shared/src/ui/SpotlightCoachMark.tsx
//
// Portable spotlight coach mark — usable in any FT2 module.
// Renders inline above the action it coaches. Floats gently on mount.
// Dismissed permanently per-user via the dismiss() callback (useSpotlight in app layer).
//
// Design: onboarding-progressive-disclosure-playbook.md §2 Layer 2.
//
// Usage:
//   <SpotlightCoachMark
//     title="These products have no supplier yet"
//     body="Assign a supplier to each one — so when stock runs low, you already know who to order from."
//     isDismissed={spotlights.neverOrdered.isDismissed}
//     onDismiss={spotlights.neverOrdered.dismiss}
//     step={1}
//     totalSteps={3}
//   />
import { Box, Typography } from '@mui/material';
import { X } from 'lucide-react';
const ARROW_SX_BY_DIRECTION = {
    left: { left: -7, top: '50%', transform: 'translateY(-50%)', borderTop: '7px solid transparent', borderBottom: '7px solid transparent', borderRight: '7px solid var(--accent-border)' },
    right: { right: -7, top: '50%', transform: 'translateY(-50%)', borderTop: '7px solid transparent', borderBottom: '7px solid transparent', borderLeft: '7px solid var(--accent-border)' },
    up: { top: -7, left: '50%', transform: 'translateX(-50%)', borderLeft: '7px solid transparent', borderRight: '7px solid transparent', borderBottom: '7px solid var(--accent-border)' },
    down: { bottom: -7, left: '50%', transform: 'translateX(-50%)', borderLeft: '7px solid transparent', borderRight: '7px solid transparent', borderTop: '7px solid var(--accent-border)' },
};
export function SpotlightCoachMark({ title, body, isDismissed, onDismiss, step, totalSteps, direction, }) {
    if (isDismissed)
        return null;
    return (_jsxs(Box, { sx: {
            position: 'relative',
            width: '100%',
            bgcolor: 'var(--accent-ghost)',
            border: '1px solid var(--accent-border)',
            borderRadius: '8px',
            p: '10px 12px',
            mb: 1,
            // Float animation — draws eye without aggression.
            // Stops on hover so user can read without distraction.
            // Respects prefers-reduced-motion.
            '@keyframes spotlight-float': {
                '0%, 100%': { transform: 'translateY(0px)' },
                '50%': { transform: 'translateY(-5px)' },
            },
            '@media (prefers-reduced-motion: no-preference)': {
                animation: 'spotlight-float 2s ease-in-out infinite',
                '&:hover': { animation: 'none' },
            },
        }, children: [direction && _jsx(Box, { sx: { position: 'absolute', width: 0, height: 0, ...ARROW_SX_BY_DIRECTION[direction] } }), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: '6px' }, children: [step && totalSteps ? (_jsxs(Typography, { sx: { fontSize: 10, fontWeight: 500, color: 'var(--ink-4)' }, children: ["\u25CF ", step, " of ", totalSteps] })) : _jsx(Box, {}), _jsx(Box, { onClick: onDismiss, sx: { cursor: 'pointer', color: 'var(--ink-4)', display: 'flex', alignItems: 'center', '&:hover': { color: 'var(--ink)' } }, children: _jsx(X, { size: 12 }) })] }), _jsx(Typography, { sx: { fontSize: 13, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.35, mb: '4px' }, children: title }), _jsx(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-3)', lineHeight: 1.5, mb: '10px' }, children: body }), _jsx(Box, { onClick: onDismiss, sx: {
                    display: 'inline-flex', alignItems: 'center',
                    px: 1.25, py: 0.375,
                    fontSize: 11, fontWeight: 500,
                    color: 'var(--accent)',
                    border: '0.5px solid var(--accent-border)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'var(--accent-ghost)' },
                }, children: "Got it" })] }));
}
