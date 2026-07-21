import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// modules/demand/src/ui/pages/DemandModuleFT2.tsx
import { useState } from 'react';
import { Box, Typography, Collapse, useTheme, } from '@mui/material';
import { TrendingDown, TrendingUp, Package, CheckCircle, ChevronDown, Minus, } from 'lucide-react';
import { formatCurrencyCompact, ModuleLoadingSkeleton, } from '@lasyncro/shared/ui';
import { ModuleErrorBoundary } from '@lasyncro/shared/ui';
// ─────────────────────────────────────────────
// STYLE TOKENS
// ─────────────────────────────────────────────
// Demand inherits FT2 app tokens. Do not reintroduce local hex palettes here.
const demandPalette = {
    cardBg: 'var(--surface)',
    border: 'var(--rule)',
    rowHover: 'var(--bg-2)',
    textPrimary: 'var(--ink)',
    textSecond: 'var(--ink-3)',
    tileBg: 'var(--bg-2)',
};
// ─────────────────────────────────────────────
// VELOCITY TREND BADGE
// ─────────────────────────────────────────────
function TrendBadge({ trend, prev, current }) {
    const theme = useTheme();
    if (trend === 'stable' || prev === 0)
        return _jsx(Minus, { size: 12, color: theme.palette.text.secondary });
    const pct = prev > 0 ? Math.round(Math.abs((current - prev) / prev) * 100) : 0;
    const isUp = trend === 'up';
    return (_jsxs(Box, { sx: { display: 'inline-flex', alignItems: 'center', gap: '2px' }, children: [isUp
                ? _jsx(TrendingUp, { size: 12, color: theme.palette.success.main })
                : _jsx(TrendingDown, { size: 12, color: theme.palette.error.main }), _jsxs(Typography, { sx: { fontSize: 10, fontWeight: 600, color: isUp ? 'success.main' : 'error.main' }, children: [pct, "%"] })] }));
}
// ─────────────────────────────────────────────
// CREATE PO HANDOFF
// ─────────────────────────────────────────────
function OrderCTA({ variant }) {
    const params = new URLSearchParams();
    params.set('action', 'create-po');
    if (variant.lasyncro_variant_id)
        params.set('variantId', variant.lasyncro_variant_id);
    if (variant.sku)
        params.set('sku', variant.sku);
    if (variant.suggested_reorder_qty)
        params.set('qty', String(variant.suggested_reorder_qty));
    if (variant.title)
        params.set('description', variant.title);
    const href = `/suppliers-portal?${params.toString()}`;
    return (_jsx(Box, { component: "a", href: href, sx: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            px: '10px',
            py: '5px',
            borderRadius: '999px',
            bgcolor: 'var(--accent)',
            color: 'var(--surface)',
            fontSize: 11,
            fontWeight: 600,
            lineHeight: 1,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            '&:hover': { opacity: 0.88 },
        }, children: "Create PO \u2192" }));
}
// ─────────────────────────────────────────────
// VARIANT ROW
// ─────────────────────────────────────────────
function VariantRow({ variant, currency, pal }) {
    const theme = useTheme();
    const isCritical = variant.reorder_urgency === 'critical';
    const isWarning = variant.reorder_urgency === 'warning';
    const accentColor = isCritical
        ? theme.palette.error.main
        : isWarning
            ? theme.palette.warning.main
            : theme.palette.text.secondary;
    const stockoutLabel = variant.estimated_stockout_date
        ? new Date(variant.estimated_stockout_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : null;
    return (_jsxs(Box, { sx: {
            display: 'grid',
            gridTemplateColumns: '2fr 80px 80px 80px 100px 120px',
            px: 2, py: 1.25,
            borderBottom: `1px solid ${pal.border}`,
            alignItems: 'center',
            gap: 1,
            borderLeft: `3px solid ${isCritical ? theme.palette.error.main : isWarning ? theme.palette.warning.main : 'transparent'}`,
            '&:hover': { background: pal.rowHover },
        }, children: [_jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 13, fontWeight: 500, color: pal.textPrimary, lineHeight: 1.3 }, children: variant.product_title ?? variant.title ?? 'Unknown product' }), _jsx(Typography, { sx: { fontSize: 10, color: pal.textSecond }, children: variant.sku
                            ? variant.sku
                            : _jsx("span", { style: { color: 'var(--ink-4)' }, children: "No SKU" }) })] }), _jsx(Typography, { sx: { fontSize: 13, color: variant.available_quantity <= 0 ? 'error.main' : pal.textPrimary }, children: variant.available_quantity }), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.5 }, children: [_jsx(Typography, { sx: { fontSize: 13, color: pal.textPrimary }, children: variant.units_sold_30d }), _jsx(TrendBadge, { trend: variant.velocity_trend, prev: variant.units_sold_prev_30d, current: variant.units_sold_30d })] }), _jsxs(Typography, { sx: { fontSize: 13, fontWeight: isCritical || isWarning ? 600 : 400, color: accentColor }, children: [variant.days_of_stock_remaining != null ? `${variant.days_of_stock_remaining}d` : '—', stockoutLabel && isCritical && (_jsxs(Typography, { component: "span", sx: { fontSize: 10, color: 'error.main', display: 'block' }, children: ["~", stockoutLabel] }))] }), _jsxs(Box, { sx: {
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    width: 'fit-content',
                    px: '7px',
                    py: '4px',
                    borderRadius: '999px',
                    bgcolor: 'var(--bg-2)',
                    border: '1px solid var(--rule)',
                }, children: [_jsx(Box, { sx: { width: 5, height: 5, borderRadius: '50%', bgcolor: accentColor } }), _jsx(Typography, { sx: { fontSize: 10, fontWeight: 600, color: accentColor, lineHeight: 1 }, children: isCritical
                            ? 'Critical'
                            : isWarning
                                ? 'Reorder soon'
                                : variant.reorder_urgency === 'overstocked'
                                    ? 'Excess stock'
                                    : variant.reorder_urgency === 'no_velocity'
                                        ? 'No recent sales'
                                        : 'Healthy' })] }), (isCritical || isWarning) ? (_jsx(OrderCTA, { variant: variant })) : (_jsx(Box, {}))] }));
}
// ─────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────
function DemandModuleFT2Inner({ data, isLoading, isError, currency, }) {
    const theme = useTheme();
    const pal = demandPalette;
    const [showRest, setShowRest] = useState(false);
    const summary = data?.summary;
    const allVariants = data?.variants ?? [];
    const actionVariants = allVariants.filter(v => v.reorder_urgency === 'critical' || v.reorder_urgency === 'warning');
    const restVariants = allVariants.filter(v => v.reorder_urgency !== 'critical' && v.reorder_urgency !== 'warning');
    const fmt = (n) => formatCurrencyCompact(n, currency?.displayCurrency, currency?.locale, currency?.rates);
    // Reorder-risk header framing.
    // Keep copy operator-friendly: Demand is about what to buy, when, and why.
    const criticalCount = summary?.critical_reorder_count ?? 0;
    const warningCount = summary?.warning_reorder_count ?? 0;
    const headerStatus = criticalCount > 0 ? 'critical' : warningCount > 0 ? 'warning' : 'healthy';
    return (_jsxs(Box, { sx: { p: { xs: 2, md: 3 } }, children: [_jsx(Box, { sx: {
                    background: pal.cardBg,
                    border: `1px solid ${pal.border}`,
                    borderRadius: '12px',
                    overflow: 'hidden',
                    mb: 2,
                }, children: _jsxs(Box, { sx: {
                        p: '1rem 1.25rem',
                        borderBottom: `1px solid ${pal.border}`,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 2,
                    }, children: [_jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 22, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2 }, children: "Demand" }), isLoading ? (_jsx(Typography, { sx: { fontSize: 16, color: pal.textPrimary }, children: "Checking reorder risk..." })) : summary ? (_jsx(Typography, { sx: { fontSize: 16, fontWeight: 500, color: headerStatus === 'critical' ? theme.palette.error.main : headerStatus === 'warning' ? theme.palette.warning.main : theme.palette.success.main }, children: criticalCount > 0
                                        ? `${criticalCount} product${criticalCount > 1 ? 's' : ''} at stockout risk`
                                        : warningCount > 0
                                            ? `${warningCount} product${warningCount > 1 ? 's' : ''} should be reordered soon`
                                            : 'No products need reordering right now' })) : null] }), summary && (_jsx(Box, { sx: { display: 'flex', gap: 1.5, flexWrap: 'wrap' }, children: [
                                { label: 'Critical', value: summary.critical_reorder_count, color: theme.palette.error.main },
                                { label: 'Reorder soon', value: summary.warning_reorder_count, color: theme.palette.warning.main },
                                { label: 'Avg cover', value: summary.avg_days_of_stock != null ? `${summary.avg_days_of_stock}d` : '—', color: pal.textPrimary },
                                { label: 'Stock value', value: fmt(summary.total_inventory_value), color: pal.textPrimary },
                            ].map(({ label, value, color }) => (_jsxs(Box, { sx: { background: pal.tileBg, borderRadius: '6px', px: 1.5, py: 0.75, minWidth: 80 }, children: [_jsx(Typography, { sx: { fontSize: 16, fontWeight: 600, color, lineHeight: 1.2 }, children: value }), _jsx(Typography, { sx: { fontSize: 10, color: pal.textSecond }, children: label })] }, label))) }))] }) }), isLoading && _jsx(ModuleLoadingSkeleton, {}), isError && (_jsx(Typography, { color: "error", sx: { p: 2 }, children: "Failed to load demand data." })), !isLoading && allVariants.length > 0 && (_jsxs(Box, { sx: {
                    background: pal.cardBg,
                    border: `1px solid ${pal.border}`,
                    borderRadius: '12px',
                    overflow: 'hidden',
                    mb: 2,
                }, children: [_jsx(Box, { sx: {
                            display: 'grid',
                            gridTemplateColumns: '2fr 80px 80px 80px 100px 120px',
                            px: 2,
                            py: 1,
                            borderBottom: `1px solid ${pal.border}`,
                            gap: 1,
                        }, children: ['Product', 'In stock', 'Sold 30d', 'Cover', 'Status', 'Action'].map(h => (_jsx(Typography, { sx: { fontSize: 10, fontWeight: 600, color: pal.textSecond, textTransform: 'uppercase', letterSpacing: '0.06em' }, children: h }, h))) }), actionVariants.length === 0 ? (_jsxs(Box, { sx: { py: 4, textAlign: 'center' }, children: [_jsx(CheckCircle, { size: 24, color: theme.palette.success.main }), _jsx(Typography, { sx: { fontSize: 13, color: pal.textSecond, mt: 1 }, children: "No products need reordering right now." })] })) : (actionVariants.map(v => (_jsx(VariantRow, { variant: v, currency: currency, pal: pal }, v.lasyncro_variant_id)))), restVariants.length > 0 && (_jsxs(_Fragment, { children: [_jsxs(Box, { onClick: () => setShowRest(v => !v), sx: {
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1,
                                    px: 2,
                                    py: 1,
                                    cursor: 'pointer',
                                    borderTop: `1px solid ${pal.border}`,
                                    '&:hover': { background: pal.rowHover },
                                }, children: [_jsx(ChevronDown, { size: 14, color: pal.textSecond, style: { transform: showRest ? 'rotate(180deg)' : 'none', transition: '0.2s' } }), _jsxs(Typography, { sx: { fontSize: 12, color: pal.textSecond }, children: [restVariants.length, " healthy / excess / no-sales product", restVariants.length > 1 ? 's' : ''] })] }), _jsx(Collapse, { in: showRest, children: restVariants.map(v => (_jsx(VariantRow, { variant: v, currency: currency, pal: pal }, v.lasyncro_variant_id))) })] }))] })), !isLoading && !isError && allVariants.length === 0 && (_jsxs(Box, { sx: { textAlign: 'center', py: 8, color: pal.textSecond }, children: [_jsx(Package, { size: 36, style: { opacity: 0.3 } }), _jsx(Typography, { sx: { mt: 2, fontSize: 14 }, children: "No demand data yet." })] }))] }));
}
export default function DemandModuleFT2(props) {
    return _jsx(ModuleErrorBoundary, { moduleName: "demand", children: _jsx(DemandModuleFT2Inner, { ...props }) });
}
//# sourceMappingURL=DemandModuleFT2.js.map