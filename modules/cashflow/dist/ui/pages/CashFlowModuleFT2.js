import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// modules/cashflow/src/ui/pages/CashFlowModuleFT2.tsx
import { useState } from 'react';
import { ModuleErrorBoundary, ModuleLoadingSkeleton } from '@lasyncro/shared/ui';
import { Box, Typography, useTheme, alpha, TextField, Button, Collapse, } from '@mui/material';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, } from 'recharts';
import { TrendingUp, Truck, AlertTriangle, ChevronDown, ChevronUp, } from 'lucide-react';
import { formatCurrencyCompact } from '@lasyncro/shared/ui';
// surface tokens → theme.palette.* and MUI sx shorthands throughout (no custom theme hook)
// ─────────────────────────────────────────────
// CUSTOM TOOLTIP
// ─────────────────────────────────────────────
function ProjectionTooltip({ active, payload, label, fmt }) {
    const theme = useTheme();
    if (!active || !payload?.length)
        return null;
    const date = new Date(label).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return (_jsxs(Box, { sx: {
            bgcolor: 'background.paper',
            border: '0.5px solid',
            borderColor: 'divider',
            borderRadius: '8px', p: 1.5, minWidth: 160,
        }, children: [_jsx(Typography, { sx: { fontSize: 11, color: theme.palette.text.secondary, mb: 1 }, children: date }), payload.map((entry) => (_jsxs(Box, { sx: { display: 'flex', justifyContent: 'space-between', gap: 2, mb: 0.25 }, children: [_jsx(Typography, { sx: { fontSize: 11, color: entry.color }, children: entry.name }), _jsxs(Typography, { sx: { fontSize: 11, fontWeight: 500, color: entry.color }, children: [entry.value >= 0 ? '+' : '', fmt(entry.value)] })] }, entry.name)))] }));
}
// ─────────────────────────────────────────────
// METRIC TILE
// ─────────────────────────────────────────────
function MetricTile({ label, value, sub, tone }) {
    const muiColor = tone === 'positive' ? 'success.main' :
        tone === 'negative' ? 'error.main' :
            tone === 'warning' ? 'warning.main' :
                'text.primary';
    return (_jsxs(Box, { sx: { bgcolor: 'background.paper', border: '0.5px solid', borderColor: 'divider', borderRadius: 2, p: 2.5, flex: 1, minWidth: 0 }, children: [_jsx(Typography, { variant: "caption", color: "text.secondary", sx: { fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', mb: 0.75, display: 'block' }, children: label }), _jsx(Typography, { variant: "h5", fontWeight: 500, color: muiColor, sx: { fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }, children: value }), sub && _jsx(Typography, { variant: "caption", color: muiColor, sx: { display: 'block', mt: 0.5 }, children: sub })] }));
}
;
function PulseRow({ label, value, delta, sub, valueColor }) {
    const deltaColor = delta == null ? 'var(--ink-4)' :
        delta > 0 ? '#22C55E' :
            delta < 0 ? '#EF4444' : 'var(--ink-4)';
    const deltaText = delta == null ? '' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`;
    return (_jsxs(Box, { sx: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', py: 1.25 }, children: [_jsxs(Box, { sx: { minWidth: 0 }, children: [_jsx(Typography, { sx: { fontSize: 12, color: 'var(--ink-4)' }, children: label }), sub && _jsx(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)', mt: 0.25 }, children: sub })] }), _jsxs(Box, { sx: { textAlign: 'right', flexShrink: 0, ml: 2 }, children: [_jsx(Typography, { sx: { fontSize: 13, fontWeight: 600, color: valueColor ?? 'var(--ink)', fontVariantNumeric: 'tabular-nums' }, children: value }), delta != null && (_jsxs(Typography, { sx: { fontSize: 11, color: deltaColor, mt: 0.25, fontVariantNumeric: 'tabular-nums' }, children: [deltaText, " vs prior"] }))] })] }));
}
// ─────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────
function CashFlowModuleFT2Inner({ data, isLoading, isError, currency, settings, onSaveSettings, }) {
    const theme = useTheme();
    const [whatIfAmount, setWhatIfAmount] = useState('');
    const [whatIfDate, setWhatIfDate] = useState('');
    // UX-sweep 2026-06-24: PO list decision-group reveal (4 visible + "See X more").
    // Follows modules-ux-playbook §Decision Group Reveal Pattern.
    const [poExpanded, setPoExpanded] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [overheadInput, setOverheadInput] = useState('');
    const [balanceInput, setBalanceInput] = useState('');
    const [settingsSaving, setSettingsSaving] = useState(false);
    const fmt = (n) => formatCurrencyCompact(n, currency?.displayCurrency, currency?.locale, currency?.rates);
    const summary = data?.summary;
    const gp = data?.gross_profit;
    const projection = data?.projection_60d ?? [];
    const poOutflows = data?.po_outflows ?? [];
    const PO_PREVIEW_LIMIT = 3;
    const visiblePos = poOutflows.slice(0, PO_PREVIEW_LIMIT);
    const hiddenPos = poOutflows.slice(PO_PREVIEW_LIMIT);
    const byConstraint = data?.by_constraint ?? [];
    const totalPoCommitments = poOutflows.reduce((s, p) => s + p.total_cost, 0);
    const atRiskRevenue = summary?.at_risk_revenue ?? 0;
    const chartData = projection.map(p => ({
        ...p,
        label: new Date(p.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    }));
    // WHAT-IF OVERLAY
    // Subtract hypothetical PO cost from all projection points after the delivery date
    const whatIfImpact = Number(whatIfAmount) || 0;
    // UX-sweep 2026-06-24: form is always visible now; gate solely on impact > 0.
    const whatIfChartData = chartData.map(p => {
        if (whatIfImpact === 0)
            return p;
        const pointDate = new Date(p.week);
        const deliveryDate = whatIfDate ? new Date(whatIfDate) : null;
        if (deliveryDate && pointDate < deliveryDate)
            return p;
        return {
            ...p,
            conservative: p.conservative - whatIfImpact,
            base: p.base - whatIfImpact,
            optimistic: p.optimistic - whatIfImpact,
        };
    });
    // UX-sweep 2026-06-23: derive headline + triage signals.
    const runwayDays = summary?.runway_days ?? null;
    const netPosition = summary?.net_cash_position ?? 0;
    const comparison = summary?.comparison ?? null;
    const realizedDelta = comparison?.delta?.realized_pct ?? null;
    const refundsDelta = comparison?.delta?.refunds_pct ?? null;
    // Overdue POs = expected_delivery_date in the past (FIN-10 semantics).
    const now = new Date();
    const overduePos = poOutflows.filter(p => p.expected_delivery_date && new Date(p.expected_delivery_date) < now);
    const overdueValue = overduePos.reduce((s, p) => s + p.total_cost, 0);
    // Projection cross — first week where base goes negative.
    const negativeCrossover = chartData.find(p => p.base < 0);
    // Triage flags.
    const hasRunwayConcern = runwayDays != null && runwayDays < 30;
    const hasOverduePos = overduePos.length > 0;
    const hasNegativeCross = !!negativeCrossover;
    const hasRefundLeakage = (summary?.total_refunded ?? 0) > 0;
    const allClear = !hasRunwayConcern && !hasOverduePos && !hasNegativeCross;
    // Headline copy.
    const headline = runwayDays == null ? 'Cash positive — no runway concern'
        : runwayDays >= 90 ? `${runwayDays} days of cash at current burn — comfortable`
            : runwayDays >= 30 ? `${runwayDays} days of cash at current burn — watch your spending`
                : `${runwayDays} days of cash at current burn — act now`;
    return (_jsxs(Box, { sx: { p: { xs: 2, md: 3 } }, children: [_jsxs(Box, { sx: { mb: 2.5 }, children: [_jsx(Typography, { sx: { fontSize: 22, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2, mb: 0.5 }, children: headline }), _jsxs(Typography, { sx: { fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5 }, children: [fmt(netPosition), " on hand", overdueValue > 0 ? ` · ${fmt(overdueValue)} of POs overdue` : '', poOutflows.length > 0 ? ` · ${poOutflows.length} open PO${poOutflows.length === 1 ? '' : 's'} ${fmt(totalPoCommitments)} committed` : ''] }), (hasOverduePos || hasNegativeCross || atRiskRevenue > 0) && (_jsxs(Box, { sx: { display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5 }, children: [hasOverduePos && (_jsxs(Box, { sx: { display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, color: theme.palette.error.main, bgcolor: alpha(theme.palette.error.main, 0.08), border: `0.5px solid ${alpha(theme.palette.error.main, 0.3)}`, borderRadius: '6px' }, children: [_jsx(Truck, { size: 12, strokeWidth: 2 }), fmt(overdueValue), " overdue \u00B7 ", overduePos.length, " PO", overduePos.length === 1 ? '' : 's'] })), hasNegativeCross && negativeCrossover && (_jsxs(Box, { sx: { display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, color: theme.palette.warning.main, bgcolor: alpha(theme.palette.warning.main, 0.08), border: `0.5px solid ${alpha(theme.palette.warning.main, 0.3)}`, borderRadius: '6px' }, children: [_jsx(AlertTriangle, { size: 12, strokeWidth: 2 }), "Cash turns negative ", new Date(negativeCrossover.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })] })), atRiskRevenue > 0 && (_jsxs(Box, { component: "a", href: "/orders?filter=blocked", sx: { display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, color: theme.palette.success.main, bgcolor: alpha(theme.palette.success.main, 0.08), border: `0.5px solid ${alpha(theme.palette.success.main, 0.3)}`, borderRadius: '6px', textDecoration: 'none', cursor: 'pointer' }, children: [_jsx(TrendingUp, { size: 12, strokeWidth: 2 }), "+", fmt(atRiskRevenue), " unlockable from ", byConstraint.reduce((s, c) => s + c.orders, 0), " blocked orders \u2192"] }))] }))] }), summary && (_jsxs(Box, { sx: { display: 'flex', flexWrap: 'wrap', gap: 2.25, alignItems: 'start', mb: 2.5 }, children: [_jsxs(Box, { sx: { flex: '1 0 300px', minWidth: 0, bgcolor: 'background.paper', border: '0.5px solid', borderColor: 'divider', borderRadius: '14px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }, children: [_jsx(Box, { sx: { p: '0.75rem 1.25rem', borderBottom: '0.5px solid', borderBottomColor: 'divider' }, children: _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1 }, children: [_jsx(Truck, { size: 13, color: theme.palette.warning.main }), _jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.08em' }, children: "Upcoming PO commitments" })] }) }), _jsx(Box, { sx: { p: '0.85rem 1.25rem', flex: 1 }, children: totalPoCommitments > 0 ? (_jsxs(_Fragment, { children: [_jsxs(Typography, { sx: { fontSize: 22, fontWeight: 500, color: 'warning.main' }, children: ["\u2212", fmt(totalPoCommitments)] }), _jsxs(Typography, { sx: { fontSize: 11, color: 'text.secondary', mt: '2px', mb: 1.5 }, children: [poOutflows.length, " open PO", poOutflows.length > 1 ? 's' : '', " \u2014 upcoming cash outflows"] }), visiblePos.map(p => (_jsxs(Box, { sx: { display: 'flex', justifyContent: 'space-between', py: '6px', borderTop: '0.5px solid', borderColor: 'divider' }, children: [_jsx(Typography, { sx: { fontSize: 12, color: 'text.primary' }, children: p.supplier_name }), _jsxs(Box, { sx: { textAlign: 'right' }, children: [_jsxs(Typography, { sx: { fontSize: 12, fontWeight: 500, color: 'warning.main' }, children: ["\u2212", fmt(p.total_cost)] }), p.expected_delivery_date && (_jsx(Typography, { sx: { fontSize: 10, color: 'text.secondary' }, children: new Date(p.expected_delivery_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }))] })] }, p.po_id))), hiddenPos.length > 0 && (_jsxs(_Fragment, { children: [_jsx(Collapse, { in: poExpanded, timeout: 180, unmountOnExit: true, children: hiddenPos.map(p => (_jsxs(Box, { sx: { display: 'flex', justifyContent: 'space-between', py: '6px', borderTop: '0.5px solid', borderColor: 'divider' }, children: [_jsx(Typography, { sx: { fontSize: 12, color: 'text.primary' }, children: p.supplier_name }), _jsxs(Box, { sx: { textAlign: 'right' }, children: [_jsxs(Typography, { sx: { fontSize: 12, fontWeight: 500, color: 'warning.main' }, children: ["\u2212", fmt(p.total_cost)] }), p.expected_delivery_date && (_jsx(Typography, { sx: { fontSize: 10, color: 'text.secondary' }, children: new Date(p.expected_delivery_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }))] })] }, p.po_id))) }), _jsxs(Box, { onClick: () => setPoExpanded(v => !v), sx: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, py: 1.125, mt: 0.5, borderTop: '1px solid var(--rule)', cursor: 'pointer', color: 'var(--accent)', '&:hover': { opacity: 0.75 } }, children: [_jsx(Typography, { sx: { fontSize: 11, fontWeight: 500 }, children: poExpanded ? 'Show less' : `See ${hiddenPos.length} more` }), poExpanded ? _jsx(ChevronUp, { size: 13 }) : _jsx(ChevronDown, { size: 13 })] })] }))] })) : (_jsx(Typography, { sx: { fontSize: 13, color: 'text.secondary' }, children: "No open PO commitments." })) })] }), _jsxs(Box, { sx: { flex: '0 0 300px', bgcolor: 'background.paper', border: '0.5px solid', borderColor: 'divider', borderRadius: '14px', p: '18px 20px' }, children: [_jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.5 }, children: "Cash pulse" }), _jsx(PulseRow, { label: "Net Position", value: fmt(netPosition), valueColor: netPosition > 0 ? theme.palette.success.main : theme.palette.error.main }), _jsx(PulseRow, { label: "Realized", value: fmt(summary.realized_revenue), delta: realizedDelta }), _jsx(PulseRow, { label: "Pending", value: fmt(summary.pending_revenue) }), _jsx(PulseRow, { label: "Refunded", value: fmt(summary.total_refunded), delta: refundsDelta, valueColor: summary.total_refunded > 0 ? theme.palette.warning.main : undefined }), _jsx(PulseRow, { label: "Working Capital", value: fmt(summary.working_capital_locked) }), _jsx(PulseRow, { label: "Inventory", value: fmt(summary.inventory_value) })] })] })), _jsxs(Box, { sx: { display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' }, gap: 2, mb: 2.5 }, children: [_jsxs(Box, { sx: { bgcolor: 'background.paper', border: '0.5px solid', borderColor: 'divider', borderRadius: '12px', overflow: 'hidden' }, children: [_jsxs(Box, { sx: { p: '0.75rem 1.25rem', borderBottom: '0.5px solid', borderBottomColor: 'divider' }, children: [_jsxs(Box, { sx: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '4px' }, children: [_jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.08em' }, children: "60-Day Cash Projection" }), _jsx(Box, { sx: { display: 'flex', alignItems: 'center', gap: 2 }, children: _jsx(Box, { sx: { display: 'flex', gap: 1.5 }, children: [
                                                        { stroke: '#DC2626', label: 'Conservative' },
                                                        { stroke: '#2563EB', label: 'Base' },
                                                        { stroke: '#16A34A', label: 'Optimistic' },
                                                    ].map(({ stroke, label }) => (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: '4px' }, children: [_jsx(Box, { sx: { width: 12, height: 2, background: stroke, borderRadius: 1 } }), _jsx(Typography, { sx: { fontSize: 10, color: 'text.secondary' }, children: label })] }, label))) }) })] }), _jsx(Typography, { sx: { fontSize: 11, color: 'text.secondary' }, children: "Projected cumulative cash change from today \u2014 based on current velocity and known PO commitments." })] }), _jsx(Box, { sx: { p: '1rem 0.5rem 0.5rem' }, children: isLoading ? (_jsx(ModuleLoadingSkeleton, { rows: 3, height: 32 })) : chartData.length === 0 ? (_jsx(Box, { sx: { height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }, children: _jsx(Typography, { sx: { fontSize: 13, color: 'text.secondary' }, children: "Not enough data for projection." }) })) : (_jsx(ResponsiveContainer, { width: "100%", height: 260, children: _jsxs(LineChart, { data: whatIfChartData, margin: { top: 5, right: 20, left: 10, bottom: 5 }, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: theme.palette.divider }), _jsx(XAxis, { dataKey: "label", tick: { fontSize: 10, fill: theme.palette.text.secondary }, axisLine: false, tickLine: false }), _jsx(YAxis, { tick: { fontSize: 10, fill: theme.palette.text.secondary }, axisLine: false, tickLine: false, tickFormatter: (v) => fmt(v) }), _jsx(Tooltip, { content: _jsx(ProjectionTooltip, { fmt: fmt }) }), _jsx(ReferenceLine, { y: 0, stroke: theme.palette.divider, strokeDasharray: "4 2" }), _jsx(Line, { type: "monotone", dataKey: "conservative", name: "Conservative", stroke: "#DC2626", strokeWidth: 1.5, dot: false, strokeDasharray: "4 2" }), _jsx(Line, { type: "monotone", dataKey: "base", name: "Base", stroke: "#2563EB", strokeWidth: 2, dot: false }), _jsx(Line, { type: "monotone", dataKey: "optimistic", name: "Optimistic", stroke: "#16A34A", strokeWidth: 1.5, dot: false, strokeDasharray: "4 2" }), whatIfImpact > 0 && (_jsx(Line, { type: "monotone", dataKey: "base", name: "Base (with PO)", stroke: "#FF6B2B", strokeWidth: 2, dot: false, strokeDasharray: "6 3" }))] }) })) })] }), _jsxs(Box, { sx: { bgcolor: 'background.paper', border: '0.5px solid', borderColor: 'divider', borderRadius: '12px', overflow: 'hidden', p: '1rem 1.25rem' }, children: [_jsx(Typography, { sx: { fontSize: 13, fontWeight: 500, color: 'var(--ink)', mb: '4px' }, children: "Plan a new stock order" }), _jsx(Typography, { sx: { fontSize: 11, color: 'text.secondary', mb: '1rem' }, children: "See how a new PO shifts your 60-day outlook." }), _jsxs(Box, { sx: { display: 'flex', flexDirection: 'column', gap: 2 }, children: [_jsx(TextField, { size: "small", label: "Total cost", placeholder: "e.g. 5000", type: "number", value: whatIfAmount, onChange: e => setWhatIfAmount(e.target.value), fullWidth: true, inputProps: { min: 0 }, helperText: "Supplier payment" }), _jsx(TextField, { size: "small", label: "Payment due date", type: "date", value: whatIfDate, onChange: e => setWhatIfDate(e.target.value), fullWidth: true, InputLabelProps: { shrink: true } }), _jsxs(Box, { onClick: () => setSettingsOpen(v => !v), sx: { display: 'inline-flex', alignItems: 'center', gap: 0.5, alignSelf: 'flex-start', cursor: 'pointer', color: 'var(--accent)', '&:hover': { opacity: 0.75 } }, children: [_jsx(Typography, { sx: { fontSize: 11, fontWeight: 500 }, children: settingsOpen ? '− Hide fixed costs & balance' : '+ Adjust fixed costs & balance' }), settingsOpen ? _jsx(ChevronUp, { size: 13 }) : _jsx(ChevronDown, { size: 13 })] }), _jsx(Collapse, { in: settingsOpen, timeout: 180, unmountOnExit: true, children: _jsxs(Box, { sx: {
                                                display: 'flex', flexDirection: 'column', gap: 2,
                                                p: '0.875rem 1rem', mt: 0.5,
                                                bgcolor: 'var(--accent-ghost)',
                                                border: '0.5px solid var(--accent-border)',
                                                borderRadius: '8px',
                                            }, children: [_jsx(Typography, { sx: { fontSize: 11, color: 'var(--accent)', fontWeight: 500 }, children: "Make projection more accurate" }), _jsx(TextField, { size: "small", label: "Monthly fixed costs", placeholder: "e.g. 5000", type: "number", value: overheadInput, onChange: e => setOverheadInput(e.target.value), fullWidth: true, inputProps: { min: 0 }, helperText: "Rent, salaries, subscriptions" }), _jsx(TextField, { size: "small", label: "Current bank balance", placeholder: "e.g. 25000", type: "number", value: balanceInput, onChange: e => setBalanceInput(e.target.value), fullWidth: true, helperText: "Your cash today" }), _jsx(Button, { size: "small", variant: "contained", disabled: settingsSaving, onClick: async () => {
                                                        if (!onSaveSettings)
                                                            return;
                                                        setSettingsSaving(true);
                                                        try {
                                                            await onSaveSettings({
                                                                ...(overheadInput !== '' ? { monthly_overhead_amount: Number(overheadInput) } : {}),
                                                                ...(balanceInput !== '' ? { starting_cash_balance: Number(balanceInput) } : {}),
                                                            });
                                                        }
                                                        finally {
                                                            setSettingsSaving(false);
                                                        }
                                                    }, sx: { bgcolor: 'var(--accent)', color: '#fff', '&:hover': { bgcolor: 'var(--accent-hover)' }, borderRadius: '8px', alignSelf: 'flex-start' }, children: settingsSaving ? 'Saving…' : 'Save' }), settings?.monthly_overhead_amount && (_jsxs(Typography, { sx: { fontSize: 10, color: 'text.secondary' }, children: ["Deducting ", fmt(settings.monthly_overhead_amount / 4.33), "/week from projection", settings.starting_cash_balance ? ` · Starting balance: ${fmt(settings.starting_cash_balance)}` : ''] }))] }) })] }), whatIfImpact > 0 && (() => {
                                const lowestPoint = whatIfChartData.reduce((min, p) => p.base < min.base ? p : min, whatIfChartData[0]);
                                const goesNegative = whatIfChartData.some(p => p.base < 0);
                                return (_jsxs(Box, { sx: {
                                        mt: '1rem', p: '0.75rem 1rem',
                                        bgcolor: goesNegative ? alpha(theme.palette.error.main, 0.08) : alpha(theme.palette.success.main, 0.08),
                                        border: '0.5px solid', borderColor: goesNegative ? 'error.main' : 'success.main',
                                        borderRadius: '8px',
                                    }, children: [_jsx(Typography, { sx: { fontSize: 12, fontWeight: 500, color: goesNegative ? 'error.main' : 'success.main', mb: '2px' }, children: goesNegative ? '⚠ May put you in the red' : '✓ You can afford this' }), _jsxs(Typography, { sx: { fontSize: 10, color: 'text.secondary' }, children: ["Low point: ", fmt(lowestPoint?.base ?? 0), " around ", lowestPoint ? new Date(lowestPoint.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'] })] }));
                            })()] })] }), isLoading && !data && _jsx(ModuleLoadingSkeleton, {})] }));
}
export default function CashFlowModuleFT2(props) {
    return (_jsx(ModuleErrorBoundary, { moduleName: "cashflow", children: _jsx(CashFlowModuleFT2Inner, { ...props }) }));
}
//# sourceMappingURL=CashFlowModuleFT2.js.map