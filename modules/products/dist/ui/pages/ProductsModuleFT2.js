import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// modules/products/src/ui/pages/ProductsModuleFT2.tsx
//
// INVENTORY MODULE — FT2 OPERATOR SURFACE
// Sprint 4 rebuild · May 2026
// ─────────────────────────────────────────────────────────────
// Layout:
//   1. Header      — DM Sans 22px/500 + live signal line
//   2. Stat Row    — 4 StatCards: Ready to Sell · Margin at Risk · Inbound · Dead Capital
//   3. Action Queue — ranked by urgency × actionability (no PO > overdue PO > low stock > no SKU > dead capital)
//   4. Inbound Pipeline — open POs with overdue flag + cash committed
//   5. Warehouse Readiness — stock-no-bin intersection signal
//   6. Return Leakage — top returned variants with restock CTA
//
// RULES:
// - No hardcoded hex. CSS variables or theme.palette.* only.
// - No inline style={}. MUI sx prop only.
// - No cross-module imports.
// - No fetching. All data via props.
// - fontWeight max 500. border 0.5px solid var(--rule).
import { Box, Typography, useTheme } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { alpha } from '@mui/material/styles';
import { Warehouse, RefreshCw } from 'lucide-react';
import { formatCurrencyCompact } from '@lasyncro/shared/ui';
// ─── HELPERS ──────────────────────────────────────────────────
const fmtN = (n) => n == null ? '—' : Math.round(n).toLocaleString();
function PulseRow({ label, value, valueColor, sub }) {
    return (_jsxs(Box, { sx: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', py: 1, borderBottom: '1px solid var(--rule)' }, children: [_jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }, children: label }), sub && _jsx(Typography, { sx: { fontSize: 10, fontWeight: 300, color: 'var(--ink-4)', mt: 0.125 }, children: sub })] }), _jsx(Typography, { sx: { fontSize: 13, fontWeight: 600, color: valueColor ?? 'var(--ink)', fontVariantNumeric: 'tabular-nums' }, children: value })] }));
}
// ─── STAT CARD ────────────────────────────────────────────────
// Matches Orders FT2 StatCard exactly.
function StatCard({ label, value, valueColor, sub, cta, ctaHref }) {
    const navigate = useNavigate();
    return (_jsxs(Box, { sx: {
            bgcolor: 'var(--surface)',
            border: '0.5px solid var(--rule)',
            borderRadius: '8px',
            p: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 0.5,
            flex: 1,
            minWidth: 0,
        }, children: [_jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }, children: label }), _jsx(Typography, { sx: { fontSize: value.length > 6 ? 20 : 24, fontWeight: 500, color: valueColor ?? 'var(--ink)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }, children: value }), sub && (_jsx(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)', mt: 0.25 }, children: sub })), cta && ctaHref && (_jsxs(Box, { onClick: () => navigate(ctaHref), sx: { display: 'inline-flex', alignItems: 'center', px: 1, py: 0.375, fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: '6px', mt: 0.5, cursor: 'pointer', '&:hover': { opacity: 0.75 } }, children: [cta, " \u2192"] }))] }));
}
// ─── SECTION HEADER ───────────────────────────────────────────
function SectionHeader({ label, meta }) {
    return (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }, children: [_jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }, children: label }), meta && (_jsx(Typography, { sx: { fontSize: 10, color: 'var(--ink-4)' }, children: meta }))] }));
}
function ActionRow({ dot, label, meta, impact, cta, ctaHref }) {
    const theme = useTheme();
    const navigate = useNavigate();
    const dotColor = dot === 'critical' ? theme.palette.error.main :
        dot === 'warning' ? theme.palette.warning.main :
            'var(--ink-4)';
    return (_jsxs(Box, { sx: {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            px: 2, py: 1.25,
            borderBottom: '0.5px solid var(--rule)',
            '&:last-child': { borderBottom: 'none' },
            '&:hover': { bgcolor: dot === 'optimize' ? 'action.hover' : alpha(dotColor, 0.04) },
        }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }, children: [_jsx(Box, { sx: { width: 6, height: 6, borderRadius: '50%', bgcolor: dotColor, flexShrink: 0 } }), _jsxs(Box, { sx: { minWidth: 0 }, children: [_jsx(Typography, { sx: { fontSize: 13, color: 'var(--ink)', fontWeight: 500 }, children: label }), meta && (_jsx(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)', mt: 0.125 }, children: meta }))] })] }), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, ml: 2 }, children: [impact && (_jsx(Typography, { sx: { fontSize: 12, fontWeight: 500, color: dot === 'critical' ? theme.palette.error.main : dot === 'warning' ? theme.palette.warning.main : 'var(--ink-4)', fontVariantNumeric: 'tabular-nums' }, children: impact })), _jsxs(Box, { onClick: () => navigate(ctaHref), sx: { display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 600, bgcolor: 'var(--accent)', color: theme.palette.common.white, borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, '&:hover': { opacity: 0.88 } }, children: [cta, " \u2192"] })] })] }));
}
// ─── INBOUND ROW ──────────────────────────────────────────────
function InboundRow({ po, isOverdue }) {
    const theme = useTheme();
    const navigate = useNavigate();
    const dateLabel = po.expected_delivery_date
        ? new Date(po.expected_delivery_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        : '—';
    const statusLabel = po.status.replace(/_/g, ' ');
    return (_jsxs(Box, { sx: {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            px: 2, py: 1.25,
            borderBottom: '0.5px solid var(--rule)',
            '&:last-child': { borderBottom: 'none' },
        }, children: [_jsx(Box, { sx: { display: 'flex', alignItems: 'center', gap: 2 }, children: _jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 13, fontWeight: 500, color: 'var(--ink)' }, children: po.supplier_name }), _jsxs(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)', fontFamily: 'monospace' }, children: [po.po_short_ref, " \u00B7 ", statusLabel] })] }) }), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 2 }, children: [_jsxs(Box, { sx: { textAlign: 'right' }, children: [_jsx(Typography, { sx: { fontSize: 12, fontWeight: 500, color: isOverdue ? theme.palette.error.main : 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }, children: isOverdue ? `${po.overdue_days}d overdue` : `Due ${dateLabel}` }), _jsxs(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)' }, children: [po.total_units_ordered, " units", po.covers_stocked_out_skus.length > 0 && ` · covers ${po.covers_stocked_out_skus.length} stocked out`] })] }), isOverdue && (_jsx(Box, { onClick: () => navigate('/orders/inbound'), sx: { display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 600, bgcolor: 'var(--accent)', color: theme.palette.common.white, borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.88 } }, children: "Chase \u2192" })), !isOverdue && po.status === 'shipped' && (_jsx(Box, { onClick: () => navigate('/orders/inbound'), sx: { display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 600, bgcolor: 'var(--accent)', color: theme.palette.common.white, borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.88 } }, children: "Receive \u2192" }))] })] }));
}
// ─── MAIN COMPONENT ───────────────────────────────────────────
export default function ProductsModuleFT2(props) {
    const theme = useTheme();
    const navigate = useNavigate();
    const { context, operatorSummary, dataFreshness, currency } = props;
    const fmt$ = (n) => formatCurrencyCompact(n, currency?.displayCurrency, currency?.locale, currency?.rates);
    const os = operatorSummary;
    const sellable = os?.sellability.sellable ?? 0;
    const blocked = os?.sellability.blocked ?? 0;
    const total = sellable + blocked;
    const noSku = os?.sellability.blockedReasons.noSku ?? 0;
    const zeroStock = os?.sellability.blockedReasons.zeroStock ?? 0;
    const phantom = os?.sellability.blockedReasons.phantom ?? 0;
    // Determine signal line
    const signalParts = [];
    if (context.variantsObserved)
        signalParts.push(`${context.variantsObserved} SKUs`);
    if (phantom > 0)
        signalParts.push(`${phantom} phantom`);
    if (zeroStock > 0)
        signalParts.push(`${zeroStock} stocked out`);
    if (os?.inbound?.total_units_expected)
        signalParts.push(`${os.inbound.total_units_expected} units inbound`);
    if (os?.warehouse?.pick_zone_occupancy_pct != null)
        signalParts.push(`${os.warehouse.pick_zone_occupancy_pct}% warehouse occupancy`);
    return (_jsxs(Box, { sx: { p: '24px 40px', minHeight: '100%', bgcolor: 'var(--bg)' }, children: [_jsxs(Box, { sx: { mb: 2.5 }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }, children: [_jsx(Box, { sx: { width: 6, height: 6, borderRadius: '50%', bgcolor: theme.palette.success.main, flexShrink: 0 } }), _jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }, children: "Live" })] }), _jsx(Typography, { sx: { fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1, letterSpacing: '-0.02em', mb: 0.375 }, children: "Inventory" }), _jsx(Typography, { sx: { fontSize: 13, color: 'var(--ink-3)' }, children: signalParts.length > 0 ? signalParts.join(' · ') : 'Loading inventory signals…' })] }), dataFreshness && Object.values(dataFreshness).some(v => v === 'stale') && (_jsxs(Box, { sx: {
                    display: 'flex', alignItems: 'center', gap: 1.5,
                    px: 2, py: 1, mb: 2.5,
                    bgcolor: alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.12 : 0.06),
                    border: `0.5px solid ${alpha(theme.palette.warning.main, 0.3)}`,
                    borderRadius: '8px',
                }, children: [_jsx(RefreshCw, { size: 12, color: theme.palette.warning.main }), _jsxs(Typography, { sx: { fontSize: 12, color: 'var(--ink-3)' }, children: ["Some data may be stale \u2014", ' ', ['structural', 'inventory', 'sales', 'fulfillment', 'cost']
                                .filter(k => dataFreshness[k] === 'stale')
                                .join(', '), ' ', "data needs a sync."] })] })), _jsxs(Box, { sx: { display: 'flex', gap: 2, alignItems: 'stretch', flexWrap: 'wrap' }, children: [os && (_jsxs(Box, { sx: { flex: 2, minWidth: 320, display: 'flex', flexDirection: 'column', gap: 2 }, children: [os?.warehouse && os.warehouse.variants_with_stock_no_bin > 0 && (_jsxs(Box, { sx: {
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    px: 2, py: 1.5,
                                    border: `0.5px solid ${alpha(theme.palette.warning.main, 0.35)}`,
                                    bgcolor: alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.08 : 0.04),
                                    borderRadius: '10px',
                                }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1.5 }, children: [_jsx(Warehouse, { size: 14, color: theme.palette.warning.main }), _jsxs(Box, { children: [_jsxs(Typography, { sx: { fontSize: 13, fontWeight: 500, color: 'var(--ink)' }, children: [os.warehouse.variants_with_stock_no_bin, " SKUs have stock but no pick bin assigned"] }), _jsxs(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)' }, children: [os.warehouse.pick_zone_occupancy_pct ?? 0, "% occupancy \u00B7 ", os.warehouse.stocked_pick_bins, " of ", os.warehouse.total_pick_bins, " bins stocked \u00B7 stow before next pick run"] })] })] }), _jsx(Box, { onClick: () => navigate('/wms/readiness'), sx: { display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap', ml: 2, '&:hover': { opacity: 0.75 } }, children: "Fix in Warehouse \u2192" })] })), _jsxs(Box, { sx: { bgcolor: 'var(--surface)', border: '0.5px solid var(--rule)', borderRadius: '10px', overflow: 'hidden', flex: 1 }, children: [_jsxs(Box, { sx: { px: 2, py: 1.25, borderBottom: '0.5px solid var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [_jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }, children: "Action queue" }), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 2 }, children: [os.demand && (os.demand.critical_reorder_count > 0 || os.demand.warning_reorder_count > 0) && (_jsxs(Typography, { sx: { fontSize: 10, color: theme.palette.error.main, fontWeight: 500 }, children: [os.demand.critical_reorder_count, " critical \u00B7 ", os.demand.warning_reorder_count, " warning"] })), _jsx(Box, { onClick: () => navigate('/demand'), sx: { display: 'inline-flex', alignItems: 'center', px: 1, py: 0.375, fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }, children: "See all in Demand \u2192" })] })] }), os.demand?.reorder_now
                                        .filter(v => {
                                        const coveredByPO = os.inbound
                                            ? [...os.inbound.overdue_pos, ...os.inbound.pending_pos].some(po => po.covers_stocked_out_skus.includes(v.lasyncro_variant_id))
                                            : false;
                                        return v.days_of_stock_remaining === 0 && !coveredByPO;
                                    })
                                        .slice(0, 4)
                                        .map(v => {
                                        const fin = os.finances?.stocked_out_margin_variants.find(f => f.lasyncro_variant_id === v.lasyncro_variant_id);
                                        return (_jsx(ActionRow, { dot: "critical", label: v.product_title ?? v.title ?? v.sku ?? 'Unknown product', meta: `Stocked out · no inbound PO · ${v.velocity_per_day.toFixed(2)} units/day`, impact: fin ? `${fmt$(fin.margin_lost_per_week)}/wk lost` : undefined, cta: "Order", ctaHref: "/suppliers" }, v.lasyncro_variant_id));
                                    }), os.inbound?.overdue_pos
                                        .filter(po => po.covers_stocked_out_skus.length > 0)
                                        .map(po => (_jsx(ActionRow, { dot: "critical", label: `${po.supplier_name} PO ${po.po_short_ref}`, meta: `${po.overdue_days}d overdue · covers ${po.covers_stocked_out_skus.length} stocked-out SKU${po.covers_stocked_out_skus.length > 1 ? 's' : ''}`, impact: po.overdue_days != null && po.overdue_days > 0 ? `${po.overdue_days}d late` : undefined, cta: "Chase", ctaHref: "/orders/inbound" }, po.po_short_ref))), noSku > 0 && (_jsx(ActionRow, { dot: "warning", label: `${noSku} SKUs have no product code`, meta: "WMS-Lite can't pick or receive these \u2014 fix in Shopify", cta: "Fix in Catalog", ctaHref: "/inventory/catalog" })), os.demand && os.demand.critical_reorder_count - os.demand.stockout_count > 0 && (_jsx(ActionRow, { dot: "warning", label: `${os.demand.critical_reorder_count - os.demand.stockout_count} SKUs under 7 days stock`, meta: "Order before they run out", cta: "See Demand", ctaHref: "/demand" })), os.demand && os.demand.dead_capital_value > 0 && (_jsx(ActionRow, { dot: "optimize", label: `${fmt$(os.demand.dead_capital_value)} in non-moving stock`, meta: "Active SKUs with stock but zero velocity", cta: "Review", ctaHref: "/demand" })), os.topReturned.length > 0 && (_jsx(ActionRow, { dot: "optimize", label: `${os.topReturned.length} returned product${os.topReturned.length > 1 ? 's' : ''} not restocked`, meta: "Every unrestocked return is double-lost \u2014 revenue refunded and inventory not recovered", cta: "Fix in Returns", ctaHref: "/returns" }))] })] })), _jsxs(Box, { sx: { flex: 1, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 2 }, children: [os && (_jsxs(Box, { sx: { bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', p: '18px 20px' }, children: [_jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }, children: "Inventory pulse" }), _jsx(PulseRow, { label: "Ready to sell", value: `${fmtN(sellable)} of ${fmtN(total)}`, valueColor: sellable === 0 ? '#E5484D' : sellable < total ? '#D9A23B' : '#4CAF7A' }), _jsx(PulseRow, { label: "Margin at risk", value: os.finances ? fmt$(os.finances.total_margin_at_risk_per_week) + '/wk' : '—', valueColor: os.finances && os.finances.total_margin_at_risk_per_week > 0 ? '#E5484D' : undefined }), _jsx(PulseRow, { label: "Phantom", value: String(phantom), valueColor: phantom > 0 ? '#E5484D' : undefined, sub: "sold without recorded receiving" }), _jsx(PulseRow, { label: "Stocked out", value: String(zeroStock), valueColor: zeroStock > 0 ? '#D9A23B' : undefined }), _jsx(PulseRow, { label: "Inbound", value: os.inbound ? `${fmtN(os.inbound.total_units_expected)} units` : '—', sub: os.inbound ? `${os.inbound.open_po_count} open PO${os.inbound.open_po_count === 1 ? '' : 's'}` : undefined }), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', pt: 1 }, children: [_jsx(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }, children: "Dead capital" }), _jsx(Typography, { sx: { fontSize: 13, fontWeight: 600, color: os.demand && os.demand.dead_capital_value > 0 ? '#D9A23B' : 'var(--ink)', fontVariantNumeric: 'tabular-nums' }, children: os.demand ? fmt$(os.demand.dead_capital_value) : '—' })] })] })), os?.inbound && os.inbound.open_po_count > 0 && (_jsxs(Box, { sx: { bgcolor: 'var(--surface)', border: '0.5px solid var(--rule)', borderRadius: '10px', overflow: 'hidden' }, children: [_jsxs(Box, { sx: { px: 2, py: 1.25, borderBottom: '0.5px solid var(--rule)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, children: [_jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }, children: "Inbound pipeline" }), _jsx(Box, { sx: { display: 'flex', alignItems: 'center', gap: 2 }, children: os.inbound.total_committed_value_cents != null && (_jsxs(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)' }, children: [fmt$(os.inbound.total_committed_value_cents / 100), "committed"] })) })] }), os.inbound.overdue_pos.map(po => (_jsx(InboundRow, { po: po, isOverdue: true }, po.po_short_ref))), os.inbound.pending_pos.map(po => (_jsx(InboundRow, { po: po, isOverdue: false }, po.po_short_ref)))] })), os?.topReturned && os.topReturned.length > 0 && (() => {
                                const maxRate = Math.max(...os.topReturned.map(r => r.returnRatePct));
                                const totalLeakage = os.topReturned.reduce((s, r) => s + r.revenueLeakage, 0);
                                return (_jsxs(Box, { sx: { bgcolor: 'var(--surface)', border: '0.5px solid var(--rule)', borderRadius: '10px', overflow: 'hidden' }, children: [_jsxs(Box, { sx: { px: 2, py: 1.25, borderBottom: '0.5px solid var(--rule)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, children: [_jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }, children: "Return leakage" }), _jsxs(Typography, { sx: { fontSize: 11, color: theme.palette.error.main, fontWeight: 500 }, children: [fmt$(totalLeakage), " lost \u00B7 0% restocked"] })] }), os.topReturned.map((item, idx) => {
                                            const barPct = maxRate > 0 ? (item.returnRatePct / maxRate) * 100 : 0;
                                            const rateColor = item.returnRatePct >= 20 ? theme.palette.error.main
                                                : item.returnRatePct >= 10 ? theme.palette.warning.main
                                                    : theme.palette.success.main;
                                            return (_jsxs(Box, { sx: {
                                                    px: 2, py: 1.5,
                                                    borderBottom: '0.5px solid var(--rule)',
                                                    '&:last-child': { borderBottom: 'none' },
                                                }, children: [_jsxs(Box, { sx: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.75 }, children: [_jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 13, fontWeight: 500, color: 'var(--ink)' }, children: item.variantTitle && item.variantTitle !== 'Default Title' ? item.variantTitle : item.sku ?? `Item ${idx + 1}` }), item.sku && (_jsx(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)', fontFamily: 'monospace' }, children: item.sku }))] }), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1.5 }, children: [_jsxs(Typography, { sx: { fontSize: 12, color: 'var(--ink-4)' }, children: [item.unitsReturned, " returned"] }), _jsxs(Typography, { sx: { fontSize: 12, fontWeight: 500, color: theme.palette.error.main }, children: [fmt$(item.revenueLeakage), " lost"] }), _jsx(Box, { onClick: () => navigate('/returns'), sx: { display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 600, bgcolor: 'var(--accent)', color: theme.palette.common.white, borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.88 } }, children: "Restock \u2192" })] })] }), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1.5 }, children: [_jsx(Box, { sx: { flex: 1, height: 4, borderRadius: 1, bgcolor: 'var(--bg)', overflow: 'hidden' }, children: _jsx(Box, { sx: { height: '100%', width: `${barPct}%`, bgcolor: rateColor, borderRadius: 1, transition: 'width 0.3s ease' } }) }), _jsxs(Typography, { sx: { fontSize: 11, fontWeight: 500, color: rateColor, minWidth: 70, textAlign: 'right' }, children: [item.returnRatePct, "% returned"] })] })] }, idx));
                                        })] }));
                            })()] })] })] }));
}
//# sourceMappingURL=ProductsModuleFT2.js.map