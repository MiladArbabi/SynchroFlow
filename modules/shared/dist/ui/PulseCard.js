import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Typography } from '@mui/material';
const TONE_SEVERITY = { critical: 0, warning: 1, neutral: 2, good: 3 };
// Pulse severity tokens — see modules-ux-playbook.md §18.
// Scope: live risk/status metrics only. Not for persisted state (--confirm-*,
// §10) or day-over-day deltas (--ft2-infoblock-diff-up).
const TONE_COLOR = {
    critical: 'var(--critical-ink)',
    warning: 'var(--warning-ink)',
    good: 'var(--good-ink)',
    neutral: 'var(--ink-2)',
};
function sortRowsBySeverity(rows) {
    return [...rows].sort((a, b) => TONE_SEVERITY[a.tone ?? 'neutral'] - TONE_SEVERITY[b.tone ?? 'neutral']);
}
function PulseCardRow({ row }) {
    const tone = row.tone ?? 'neutral';
    const clickable = typeof row.onClick === 'function';
    const content = (_jsxs(Box, { sx: {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            py: 1, px: clickable ? 1 : 0, mx: clickable ? -1 : 0,
            borderRadius: clickable ? '6px' : 0, cursor: clickable ? 'pointer' : 'default',
            transition: 'background-color 0.12s',
            '&:hover': clickable ? { bgcolor: 'var(--bg-3)' } : undefined,
            '&:focus-visible': clickable ? { outline: '2px solid var(--accent)', outlineOffset: '2px' } : undefined,
        }, children: [_jsxs(Box, { sx: { display: 'flex', flexDirection: 'column', gap: 0.5, flex: 1, minWidth: 0 }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.75 }, children: [_jsx(Box, { "aria-hidden": true, sx: { width: 6, height: 6, borderRadius: '50%', bgcolor: TONE_COLOR[tone], flexShrink: 0 } }), _jsx(Typography, { sx: { fontSize: 13, fontWeight: 400, color: 'var(--ink-3)' }, children: row.label })] }), row.subtext && (_jsx(Typography, { sx: { fontSize: 11, fontWeight: 300, color: 'var(--ink-4)', pl: '14px' }, children: row.subtext })), row.progress && (_jsx(Box, { sx: { height: 4, borderRadius: '2px', bgcolor: 'var(--rule)', overflow: 'hidden', ml: '14px', mt: 0.5 }, children: _jsx(Box, { sx: { height: '100%', width: `${Math.min(100, (row.progress.value / row.progress.max) * 100)}%`, bgcolor: TONE_COLOR[tone], transition: 'width 0.2s' } }) }))] }), row.action ? (_jsx(Box, { component: "button", onClick: (e) => { e.stopPropagation(); row.action.onClick(); }, sx: {
                    fontSize: 11, fontWeight: 500, color: 'var(--accent)',
                    bgcolor: 'transparent', border: '0.5px solid var(--accent)',
                    borderRadius: '6px', px: 1.25, py: 0.5, cursor: 'pointer',
                    whiteSpace: 'nowrap', flexShrink: 0, '&:hover': { opacity: 0.75 },
                }, children: row.action.label })) : (_jsx(Typography, { sx: { fontSize: 15, fontWeight: 600, color: tone === 'neutral' ? 'var(--ink)' : TONE_COLOR[tone], flexShrink: 0, pl: 1 }, children: row.value }))] }));
    if (!clickable)
        return content;
    return (_jsx(Box, { role: "button", tabIndex: 0, onClick: row.onClick, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            row.onClick();
        } }, children: content }));
}
export function PulseCard({ title, headline, rows, footerCta, updatedAt, onRefresh }) {
    const sortedRows = sortRowsBySeverity(rows);
    const groups = [];
    for (const row of sortedRows) {
        const last = groups[groups.length - 1];
        if (last && last.key === row.group)
            last.rows.push(row);
        else
            groups.push({ key: row.group, rows: [row] });
    }
    return (_jsxs(Box, { sx: { bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', p: '18px 20px', display: 'flex', flexDirection: 'column', gap: 1 }, children: [_jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }, children: title }), headline && (_jsxs(Box, { sx: { pb: 1, mb: 0.5, borderBottom: '1px solid var(--rule)' }, children: [_jsx(Typography, { sx: { fontSize: 28, fontWeight: 600, color: TONE_COLOR[headline.tone], lineHeight: 1.1 }, children: headline.value }), headline.subtext && (_jsx(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-4)', mt: 0.5 }, children: headline.subtext }))] })), groups.map((group, gi) => (_jsx(Box, { sx: { pb: gi < groups.length - 1 ? 1 : 0, mb: gi < groups.length - 1 ? 1 : 0, borderBottom: gi < groups.length - 1 ? '1px solid var(--rule)' : 'none' }, children: group.rows.map((row) => _jsx(PulseCardRow, { row: row }, row.id)) }, group.key ?? `group-${gi}`))), (footerCta || updatedAt) && (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', pt: 1, mt: 0.5, borderTop: footerCta && updatedAt ? '1px solid var(--rule)' : 'none' }, children: [footerCta && (_jsxs(Box, { component: "button", onClick: footerCta.onClick, sx: {
                            fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase',
                            color: 'var(--accent)', bgcolor: 'transparent', border: '0.5px solid var(--accent)',
                            borderRadius: '6px', px: 1.25, py: 0.5, cursor: 'pointer', '&:hover': { opacity: 0.75 },
                            width: footerCta && !updatedAt ? '100%' : 'auto', textAlign: 'center',
                        }, children: [footerCta.label, " \u2192"] })), updatedAt && (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.5 }, children: [_jsx(Typography, { sx: { fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }, children: updatedAt }), onRefresh && (_jsx(Box, { component: "button", onClick: onRefresh, "aria-label": "Refresh", sx: { bgcolor: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', display: 'flex' }, children: "\u21BB" }))] }))] }))] }));
}
