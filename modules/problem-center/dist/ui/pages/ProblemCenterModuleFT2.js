import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// modules/problem-center/src/ui/pages/ProblemCenterModuleFT2.tsx
//
// PROBLEM CENTER — FT2 OPERATOR SURFACE
// Supervisor surface for pick/pack/stow/receive exceptions.
//
// DESIGN CONTRACT:
// - Table layout matching Returns — same mental model, different domain
// - FT2 pattern: CSS vars, 0.5px borders, fontWeight max 500
// - Pagination: 10 rows per page
// - Resolve dialog — inline action, same as before
// - No hardcoded hex, no Paper/outlined, no fontWeight 700
import { useState } from 'react';
import { Box, Typography, Chip, Button, Alert, TextField, Dialog, DialogTitle, DialogContent, DialogActions, Divider, useTheme, } from '@mui/material';
import { PackageX, Filter, CheckCircle } from 'lucide-react';
import { ModuleErrorBoundary, ModuleLoadingSkeleton } from '@lasyncro/shared/ui';
const EXCEPTION_TYPE_LABELS = {
    item_missing: { label: 'Item Missing', color: 'error' },
    short_pick: { label: 'Short Pick', color: 'warning' },
    product_defect: { label: 'Product Defect', color: 'error' },
    packaging_defect: { label: 'Packaging Defect', color: 'warning' },
    order_cancelled: { label: 'Order Cancelled', color: 'default' },
    wrong_item: { label: 'Wrong Item', color: 'error' },
    stow_failure: { label: 'Stow Failure', color: 'warning' },
    receive_rejection: { label: 'Receive Rejection', color: 'warning' },
};
const STAGE_LABELS = {
    pick: 'Pick', pack: 'Pack', stow: 'Stow', receive: 'Receive',
};
const STAGE_COLORS = {
    pick: '#14B8A6',
    pack: '#3B82F6',
    stow: '#8B5CF6',
    receive: '#F59E0B',
};
const PER_PAGE_DEFAULT = 10;
// Maps exception type → sensible default resolution action
const DEFAULT_ACTION = {
    item_missing: 'write_off',
    short_pick: 'write_off',
    product_defect: 'discard',
    packaging_defect: 're_stow',
    wrong_item: 'find_replacement',
    // INV-BLOCK-10b: cancelled units are good stock in the problem bin,
    // not shrinkage. Default to putting them back on a shelf.
    order_cancelled: 're_stow',
    stow_failure: 're_stow',
    receive_rejection: 'quarantine',
    repackaging_required: 're_stow',
    return_shortfall: 'write_off',
};
// Resolution options shown in dialog
// forTypes: if set, only shown when exception matches one of those types
const RESOLUTION_OPTIONS = [
    {
        action: 're_stow',
        label: 'Re-stow',
        description: 'Item is fine — place it back into the correct bin location.',
        forTypes: ['packaging_defect', 'stow_failure', 'wrong_item', 'repackaging_required', 'order_cancelled'],
    },
    {
        action: 'find_replacement',
        label: 'Find Replacement',
        description: 'Locate same SKU at an alternate bin and fulfil the order from there.',
        forTypes: ['wrong_item', 'item_missing', 'short_pick'],
    },
    {
        action: 'discard',
        label: 'Discard',
        description: 'Item is damaged beyond use. Removes from inventory permanently.',
        forTypes: ['product_defect', 'packaging_defect', 'receive_rejection'],
    },
    {
        action: 'write_off',
        label: 'Write Off',
        description: 'Item is unaccounted for. Records as shrinkage and removes from inventory.',
        forTypes: ['item_missing', 'short_pick', 'order_cancelled', 'return_shortfall'],
    },
    {
        action: 'quarantine',
        label: 'Quarantine',
        description: 'Hold item for further investigation. No inventory change.',
    },
];
// ── Age formatter ─────────────────────────────────────────────
const fmtAge = (iso) => {
    const h = Math.round((Date.now() - new Date(iso).getTime()) / 3600000);
    if (h < 1)
        return '<1h ago';
    if (h < 24)
        return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
};
function ProblemCenterModuleFT2Inner({ data, isLoading, isError, onResolve, onRefresh, }) {
    const theme = useTheme();
    const [stageFilter, setStageFilter] = useState('all');
    const [typeFilter, setTypeFilter] = useState('all');
    const [showResolved, setShowResolved] = useState(false);
    const [page, setPage] = useState(1);
    const [perPage, setPerPage] = useState(PER_PAGE_DEFAULT);
    const [sortField, setSortField] = useState('created_at');
    const [sortDir, setSortDir] = useState('desc');
    const handlePCSort = (field) => {
        if (sortField === field) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        }
        else {
            setSortField(field);
            setSortDir('asc');
        }
        setPage(1);
    };
    const [resolveDialog, setResolveDialog] = useState(null);
    const [resolutionAction, setResolutionAction] = useState('write_off');
    const [resolutionNote, setResolutionNote] = useState('');
    const [resolving, setResolving] = useState(false);
    const [resolveError, setResolveError] = useState(null);
    const tasks = data?.tasks ?? [];
    const filtered = tasks.filter((t) => {
        const isResolved = t.status === 'resolved' || t.status === 'discarded' || t.status === 'returned_to_supplier';
        if (!showResolved && isResolved)
            return false;
        if (stageFilter !== 'all' && t.source !== stageFilter)
            return false;
        if (typeFilter !== 'all' && t.exception_type !== typeFilter)
            return false;
        return true;
    });
    const sorted = [...filtered].sort((a, b) => {
        const mul = sortDir === 'asc' ? 1 : -1;
        if (sortField === 'quantity')
            return mul * (a.quantity - b.quantity);
        if (sortField === 'created_at')
            return mul * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        const al = (a.variant_title ?? a.sku ?? '').toLowerCase();
        const bl = (b.variant_title ?? b.sku ?? '').toLowerCase();
        return mul * al.localeCompare(bl);
    });
    const totalPages = Math.ceil(sorted.length / perPage);
    const paged = sorted.slice((page - 1) * perPage, page * perPage);
    const handleFilterChange = (fn) => { fn(); setPage(1); };
    const handleResolve = async () => {
        if (!resolveDialog)
            return;
        setResolving(true);
        setResolveError(null);
        try {
            await onResolve(resolveDialog.id, resolutionAction, resolutionNote);
            setResolveDialog(null);
            setResolutionNote('');
            setResolutionAction('write_off');
            onRefresh();
        }
        catch {
            setResolveError('Failed to resolve exception. Try again.');
        }
        finally {
            setResolving(false);
        }
    };
    // Column header component
    const ColHeader = ({ label, field }) => (_jsxs(Box, { onClick: () => field && handlePCSort(field), sx: { display: 'flex', alignItems: 'center', gap: 0.5, cursor: field ? 'pointer' : 'default' }, children: [_jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: field && sortField === field ? 'var(--accent)' : 'var(--ink-4)' }, children: label }), field && sortField === field && (_jsx(Typography, { sx: { fontSize: 9, color: 'var(--accent)' }, children: sortDir === 'asc' ? '↑' : '↓' }))] }));
    return (_jsxs(Box, { sx: { p: '24px 40px', bgcolor: 'var(--bg)', minHeight: '100%' }, children: [_jsxs(Box, { sx: { mb: 2.5 }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.25 }, children: [_jsx(Typography, { sx: { fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1, letterSpacing: '-0.02em', mb: 0.375 }, children: "Problem Center" }), (data?.total_unresolved ?? 0) > 0 && (_jsx(Box, { sx: { display: 'inline-flex', alignItems: 'center', px: 1.5, py: 0.375, borderRadius: '20px', bgcolor: theme.palette.mode === 'dark' ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.1)', border: `0.5px solid rgba(239,68,68,0.35)` }, children: _jsxs(Typography, { sx: { fontSize: 11, fontWeight: 500, color: theme.palette.error.main }, children: [data?.total_unresolved, " unresolved"] }) }))] }), _jsx(Typography, { sx: { fontSize: 13, color: 'var(--ink-3)' }, children: "Pick, pack, stow, and receive exceptions requiring supervisor resolution." })] }), isLoading && _jsx(ModuleLoadingSkeleton, {}), isError && _jsx(Alert, { severity: "error", sx: { mb: 3 }, children: "Failed to load Problem Center. Please refresh." }), !isLoading && !isError && (_jsxs(_Fragment, { children: [_jsxs(Box, { sx: { bgcolor: 'var(--surface)', border: '0.5px solid var(--rule)', borderRadius: '10px', p: 2, mb: 2 }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }, children: [_jsx(Filter, { size: 12, color: "var(--ink-4)" }), _jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }, children: "Filters" })] }), _jsx(Box, { sx: { display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }, children: ['all', 'pick', 'pack', 'stow', 'receive'].map((s) => (_jsx(Chip, { label: s === 'all' ? 'All stages' : STAGE_LABELS[s], size: "small", variant: stageFilter === s ? 'filled' : 'outlined', onClick: () => handleFilterChange(() => setStageFilter(s)), color: stageFilter === s ? 'primary' : 'default' }, s))) }), _jsxs(Box, { sx: { display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }, children: [_jsx(Chip, { label: "All types", size: "small", variant: typeFilter === 'all' ? 'filled' : 'outlined', onClick: () => handleFilterChange(() => setTypeFilter('all')), color: typeFilter === 'all' ? 'primary' : 'default' }), Object.entries(EXCEPTION_TYPE_LABELS).map(([key, { label }]) => (_jsx(Chip, { label: label, size: "small", variant: typeFilter === key ? 'filled' : 'outlined', onClick: () => handleFilterChange(() => setTypeFilter(key)), color: typeFilter === key ? 'primary' : 'default' }, key)))] }), _jsx(Chip, { label: showResolved ? 'Hiding resolved' : 'Show resolved', size: "small", variant: showResolved ? 'filled' : 'outlined', onClick: () => handleFilterChange(() => setShowResolved(v => !v)) })] }), _jsxs(Box, { sx: { bgcolor: 'var(--surface)', border: '0.5px solid var(--rule)', borderRadius: '10px', overflow: 'hidden' }, children: [_jsxs(Box, { sx: { display: 'grid', gridTemplateColumns: '2fr 80px 140px 80px 120px 100px 80px 100px', gap: 0, px: 2, py: 1.25, borderBottom: '0.5px solid var(--rule)', bgcolor: 'var(--bg)' }, children: [_jsx(ColHeader, { label: "Exception", field: "exception" }), _jsx(ColHeader, { label: "Stage" }), _jsx(ColHeader, { label: "Type" }), _jsx(ColHeader, { label: "Qty", field: "quantity" }), _jsx(ColHeader, { label: "Prob Label" }), _jsx(ColHeader, { label: "Bin" }), _jsx(ColHeader, { label: "Age", field: "created_at" }), _jsx(ColHeader, { label: "Action" })] }), filtered.length === 0 && (_jsxs(Box, { sx: { textAlign: 'center', py: 8 }, children: [_jsx(PackageX, { size: 36, style: { opacity: 0.25, margin: '0 auto' } }), _jsx(Typography, { sx: { fontSize: 13, color: 'var(--ink-4)', mt: 2 }, children: tasks.length === 0
                                            ? 'No open exceptions'
                                            : 'No exceptions match the current filters.' })] })), paged.map((t, idx) => {
                                const typeInfo = EXCEPTION_TYPE_LABELS[t.exception_type] ?? { label: t.exception_type, color: 'default' };
                                const stageColor = STAGE_COLORS[t.source] ?? 'var(--ink-4)';
                                const label = t.variant_title && t.variant_title !== 'Default Title' ? t.variant_title : t.sku ?? t.lasyncro_variant_id.slice(0, 8).toUpperCase();
                                const isResolved = t.status === 'resolved' || t.status === 'discarded' || t.status === 'returned_to_supplier';
                                return (_jsxs(Box, { children: [idx > 0 && _jsx(Divider, { sx: { borderColor: 'var(--rule)' } }), _jsxs(Box, { sx: {
                                                display: 'grid',
                                                gridTemplateColumns: '2fr 80px 140px 80px 120px 100px 80px 100px',
                                                gap: 0, px: 2, py: 1.25,
                                                alignItems: 'center',
                                                opacity: isResolved ? 0.5 : 1,
                                                '&:hover': { bgcolor: 'action.hover' },
                                            }, children: [_jsxs(Box, { children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1 }, children: [_jsx(Typography, { sx: { fontSize: 13, fontWeight: 500, color: 'var(--ink)' }, children: label }), isResolved && _jsx(CheckCircle, { size: 12, color: theme.palette.success.main })] }), t.sku && t.sku !== t.variant_title && (_jsx(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)', fontFamily: 'monospace' }, children: t.sku }))] }), _jsx(Box, { sx: { display: 'inline-flex', alignItems: 'center', px: 1, py: 0.25, borderRadius: '4px', bgcolor: `${stageColor}22`, border: `0.5px solid ${stageColor}55`, width: 'fit-content' }, children: _jsx(Typography, { sx: { fontSize: 11, fontWeight: 500, color: stageColor }, children: STAGE_LABELS[t.source] ?? t.source }) }), _jsx(Chip, { label: typeInfo.label, color: typeInfo.color, size: "small", sx: { width: 'fit-content' } }), _jsx(Typography, { sx: { fontSize: 13, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }, children: t.quantity }), _jsx(Typography, { sx: { fontSize: 12, color: 'var(--ink-4)', fontFamily: 'monospace' }, children: t.prob_label ?? '—' }), _jsx(Typography, { sx: { fontSize: 12, color: 'var(--ink-4)', fontFamily: 'monospace' }, children: t.problem_bin_location ?? '—' }), _jsx(Typography, { sx: { fontSize: 12, color: 'var(--ink-4)' }, children: fmtAge(t.created_at) }), isResolved ? (_jsx(Typography, { sx: { fontSize: 11, color: theme.palette.success.main, fontWeight: 500 }, children: "Resolved" })) : (_jsx(Box, { onClick: () => { setResolveDialog({ id: t.problem_task_id, exceptionType: t.exception_type }); setResolutionNote(''); setResolutionAction(DEFAULT_ACTION[t.exception_type] ?? 'write_off'); setResolveError(null); }, sx: { display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.5, fontSize: 12, fontWeight: 600, bgcolor: 'var(--accent)', color: theme.palette.common.white, borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.88 } }, children: "Resolve \u2192" }))] })] }, t.problem_task_id));
                            }), sorted.length > 0 && (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1, bgcolor: 'var(--bg)', borderTop: '0.5px solid var(--rule)' }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1.5 }, children: [_jsxs(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)' }, children: [((page - 1) * perPage) + 1, "\u2013", Math.min(page * perPage, sorted.length), " of ", sorted.length, " exceptions"] }), _jsx(Box, { sx: { display: 'flex', gap: 0.5 }, children: [10, 25, 50, 100].map(n => (_jsx(Box, { onClick: () => { setPerPage(n); setPage(1); }, sx: { px: 1, py: 0.25, fontSize: 10, border: '0.5px solid', borderColor: n === perPage ? 'var(--accent)' : 'var(--rule)', borderRadius: '4px', bgcolor: n === perPage ? 'var(--accent-ghost)' : 'var(--surface)', color: n === perPage ? 'var(--accent)' : 'var(--ink-4)', cursor: 'pointer', fontWeight: n === perPage ? 600 : 400 }, children: n }, n))) })] }), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.5 }, children: [totalPages > 1 && _jsx(Box, { onClick: () => page > 1 && setPage(p => p - 1), sx: { px: 1.5, py: 0.5, borderRadius: '6px', cursor: page > 1 ? 'pointer' : 'not-allowed', border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)', fontSize: 12, color: page > 1 ? 'var(--ink-3)' : 'var(--ink-4)', opacity: page > 1 ? 1 : 0.4 }, children: "\u2190 Prev" }), totalPages > 1 && Array.from({ length: totalPages }, (_, i) => (_jsx(Box, { onClick: () => setPage(i + 1), sx: { px: 1.5, py: 0.5, fontSize: 11, border: '0.5px solid', borderColor: i + 1 === page ? 'var(--accent)' : 'var(--rule)', borderRadius: '6px', bgcolor: i + 1 === page ? 'var(--accent)' : 'var(--surface)', color: i + 1 === page ? '#fff' : 'var(--ink-3)', cursor: 'pointer', fontWeight: i + 1 === page ? 600 : 400 }, children: i + 1 }, i))), totalPages > 1 && _jsx(Box, { onClick: () => page < totalPages && setPage(p => p + 1), sx: { px: 1.5, py: 0.5, borderRadius: '6px', cursor: page < totalPages ? 'pointer' : 'not-allowed', border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)', fontSize: 12, color: page < totalPages ? 'var(--ink-3)' : 'var(--ink-4)', opacity: page < totalPages ? 1 : 0.4 }, children: "Next \u2192" })] })] }))] })] })), _jsxs(Dialog, { open: !!resolveDialog, onClose: () => setResolveDialog(null), fullWidth: true, maxWidth: "sm", children: [_jsx(DialogTitle, { sx: { fontSize: 16, fontWeight: 500 }, children: "Resolve Exception" }), _jsxs(DialogContent, { sx: { display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }, children: [_jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 12, fontWeight: 500, color: 'var(--ink-4)', mb: 1 }, children: "RESOLUTION ACTION" }), _jsx(Box, { sx: { display: 'flex', flexDirection: 'column', gap: 0.5 }, children: RESOLUTION_OPTIONS.filter(o => !o.forTypes || o.forTypes.includes(resolveDialog?.exceptionType ?? '')).map((opt) => (_jsxs(Box, { onClick: () => setResolutionAction(opt.action), sx: {
                                                display: 'flex', flexDirection: 'column', px: 1.5, py: 1,
                                                borderRadius: '6px', cursor: 'pointer',
                                                border: resolutionAction === opt.action
                                                    ? '0.5px solid var(--accent)'
                                                    : '0.5px solid var(--rule)',
                                                bgcolor: resolutionAction === opt.action
                                                    ? 'var(--accent-subtle, rgba(99,102,241,0.06))'
                                                    : 'transparent',
                                                transition: 'border-color 0.15s, background-color 0.15s',
                                            }, children: [_jsx(Typography, { sx: { fontSize: 13, fontWeight: 500, color: resolutionAction === opt.action ? 'var(--accent)' : 'var(--ink)' }, children: opt.label }), _jsx(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)' }, children: opt.description })] }, opt.action))) })] }), _jsx(TextField, { label: "Note (optional)", multiline: true, rows: 2, fullWidth: true, size: "small", value: resolutionNote, onChange: (e) => setResolutionNote(e.target.value), placeholder: "e.g. Moved to problem bin A-3, awaiting supplier collection", InputProps: { sx: { fontSize: 13 } } }), resolveError && _jsx(Alert, { severity: "error", children: resolveError })] }), _jsxs(DialogActions, { children: [_jsx(Button, { onClick: () => setResolveDialog(null), sx: { fontSize: 13 }, children: "Cancel" }), _jsx(Button, { variant: "contained", onClick: () => void handleResolve(), disabled: resolving, sx: { fontSize: 13 }, children: resolving ? 'Resolving…' : 'Confirm' })] })] })] }));
}
export default function ProblemCenterModuleFT2(props) {
    return _jsx(ModuleErrorBoundary, { moduleName: "problem-center", children: _jsx(ProblemCenterModuleFT2Inner, { ...props }) });
}
//# sourceMappingURL=ProblemCenterModuleFT2.js.map