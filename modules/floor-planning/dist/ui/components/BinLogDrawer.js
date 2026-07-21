import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// modules/floor-planning/src/ui/components/BinLogDrawer.tsx
import { Box, Typography, Divider, IconButton, CircularProgress } from '@mui/material';
import { X, ArrowDown, ArrowUp, RefreshCw } from 'lucide-react';
/**
 * BinLogDrawer — slide-in activity timeline for a selected bin.
 *
 * Shows merged inventory_movements + pick_scan_log events for the bin,
 * sorted newest first.
 *
 * operator_name is null for pre-traceability or system-driven movements —
 * shown as "System" until traceability sprint writers are updated (0107).
 *
 * TRACEABILITY SPRINT: enrich with picks 7D, reorder signal, ghost stock flag.
 */
const MOVEMENT_LABELS = {
    inbound_purchase: { label: 'Received', inbound: true },
    sale: { label: 'Sold', inbound: false },
    pick_scan: { label: 'Picked', inbound: false },
    refund_return: { label: 'Return', inbound: true },
    damage: { label: 'Damaged', inbound: false },
    shrinkage: { label: 'Shrinkage', inbound: false },
    manual_adjustment: { label: 'Adjustment', inbound: true },
    reservation_hold: { label: 'Reserved', inbound: false },
    reservation_release: { label: 'Released', inbound: true },
    opening_balance: { label: 'Opening stock', inbound: true },
    reconciliation_correction: { label: 'Correction', inbound: true },
};
function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1)
        return 'just now';
    if (mins < 60)
        return `${mins}m ago`;
    if (hours < 24)
        return `${hours}h ago`;
    return `${days}d ago`;
}
export function BinLogDrawer({ locationCode, events, isLoading, open, onClose }) {
    return (_jsxs(Box, { sx: {
            position: 'absolute',
            top: 0,
            right: 0,
            height: '100%',
            width: open ? 360 : 0,
            minWidth: open ? 360 : 0,
            overflow: 'hidden',
            transition: 'width 0.25s ease, min-width 0.25s ease',
            bgcolor: 'var(--bg)',
            borderLeft: open ? '1px solid var(--rule)' : 'none',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 10,
        }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 3, py: 2.5, borderBottom: '1px solid var(--rule)', flexShrink: 0 }, children: [_jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.25 }, children: "Bin Activity" }), _jsx(Typography, { sx: { fontSize: 18, fontWeight: 700, fontFamily: 'monospace', color: 'var(--ink)' }, children: locationCode })] }), _jsx(IconButton, { onClick: onClose, size: "small", sx: { color: 'var(--ink-3)' }, children: _jsx(X, { size: 16 }) })] }), _jsxs(Box, { sx: { flex: 1, overflowY: 'auto', px: 3, py: 2 }, children: [isLoading && (_jsx(Box, { sx: { display: 'flex', justifyContent: 'center', py: 6 }, children: _jsx(CircularProgress, { size: 24, sx: { color: 'var(--accent)' } }) })), !isLoading && events.length === 0 && (_jsx(Box, { sx: { py: 6, textAlign: 'center' }, children: _jsx(Typography, { sx: { fontSize: 13, color: 'var(--ink-4)' }, children: "No activity recorded for this bin yet." }) })), !isLoading && events.map((event, i) => {
                        const meta = MOVEMENT_LABELS[event.movement_type] ?? { label: event.movement_type, inbound: event.quantity_delta > 0 };
                        const inbound = event.quantity_delta > 0;
                        const qty = Math.abs(event.quantity_delta);
                        const operator = event.operator_name?.trim() || 'System';
                        return (_jsxs(Box, { children: [_jsxs(Box, { sx: { display: 'flex', gap: 1.5, py: 1.5, alignItems: 'flex-start' }, children: [_jsx(Box, { sx: {
                                                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                bgcolor: inbound ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.10)',
                                            }, children: inbound
                                                ? _jsx(ArrowDown, { size: 13, color: "rgba(34,197,94,0.9)" })
                                                : _jsx(ArrowUp, { size: 13, color: "rgba(239,68,68,0.8)" }) }), _jsxs(Box, { sx: { flex: 1, minWidth: 0 }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.25 }, children: [_jsxs(Typography, { sx: { fontSize: 13, fontWeight: 600, color: 'var(--ink)' }, children: [meta.label, _jsxs(Typography, { component: "span", sx: { fontSize: 13, fontWeight: 700, color: inbound ? 'rgba(34,197,94,0.9)' : 'rgba(239,68,68,0.8)', ml: 0.75 }, children: [inbound ? '+' : '-', qty] })] }), _jsx(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)', flexShrink: 0, ml: 1 }, children: timeAgo(event.event_at) })] }), event.sku && (_jsx(Typography, { sx: { fontSize: 11, fontFamily: 'monospace', color: 'var(--ink-3)', mb: 0.25 }, children: event.sku })), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.5 }, children: [_jsx(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)' }, children: operator }), event.reference_type && (_jsxs(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)' }, children: ["\u00B7 ", event.reference_type.replace(/_/g, ' ')] }))] })] })] }), i < events.length - 1 && _jsx(Divider, {})] }, event.id));
                    })] }), _jsx(Box, { sx: { px: 3, py: 2, borderTop: '1px solid var(--rule)', flexShrink: 0 }, children: _jsxs(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)', display: 'flex', alignItems: 'center', gap: 0.5 }, children: [_jsx(RefreshCw, { size: 11 }), "Last 50 events \u00B7 refreshes every 30s"] }) })] }));
}
//# sourceMappingURL=BinLogDrawer.js.map