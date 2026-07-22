import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// modules/overview/src/ui/pages/OverviewModuleFT2.tsx
//
// OVERVIEW — "A: Triage-first" layout from the LaSyncro design file.
//
// LAYOUT:
//   HEADER (greeting · date · summary · page actions)
//   ────────────────────────────────────────────────────────────
//   BODY  [  Needs a decision (flex-1)  |  TODAY'S FLOW (280px)  ]
//
// RULES: No alpha(). No useTheme(). No fontFamily overrides. No 0.5px borders.
//        CSS vars for adaptive colors; direct hex only for severity tokens.
//        Severity palette: #E5484D critical · #D9A23B watch · #4CAF7A on-track.
import { useState } from 'react';
import { Box, Collapse, Typography, Skeleton } from '@mui/material';
import { RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { formatCurrencyCompact, ModuleErrorBoundary } from '@lasyncro/shared/ui';
// ─── CONSTANTS ────────────────────────────────────────────────
const TRIAGE_PREVIEW_LIMIT = 3;
// Baked severity palette — no alpha() needed
const SEV = {
    critical: {
        color: '#E5484D',
        bgBand: 'rgba(229,72,77,0.06)',
        badge: 'rgba(229,72,77,0.12)',
        band: 'CRITICAL — ACT TODAY',
    },
    watch: {
        color: '#D9A23B',
        bgBand: 'rgba(217,162,59,0.06)',
        badge: 'rgba(217,162,59,0.12)',
        band: 'WATCH',
    },
    ontrack: {
        color: '#4CAF7A',
        bgBand: 'rgba(76,175,122,0.05)',
        badge: 'rgba(76,175,122,0.10)',
        band: 'EVERYTHING ELSE',
    },
};
function sevKey(priority) {
    if (priority <= 2)
        return 'critical';
    if (priority <= 4)
        return 'watch';
    return 'ontrack';
}
const MODULE_LABELS = {
    'order-nexus': 'Orders',
    'cashflow': 'Cash Flow',
    'finances': 'Finances',
    'wms': 'Warehouse',
    'suppliers-portal': 'Suppliers',
    'floor-planning': 'Floor Planning',
    'overview': 'Overview',
    'products': 'Products',
    'customers': 'Customers',
    'demand': 'Demand',
    'returns': 'Returns',
};
const DEFAULT_ACTIONS = {
    'order-nexus': 'Review queue',
    'wms': 'Review floor',
    'demand': 'Reorder',
    'suppliers-portal': 'View supplier',
    'returns': 'Review returns',
    'finances': 'View finances',
    'cashflow': 'View cashflow',
};
function moduleLabel(m) { return MODULE_LABELS[m] ?? m; }
function actionLabel(signal) {
    return signal.actionLabel ?? DEFAULT_ACTIONS[signal.module] ?? 'Review ›';
}
/* # ISS-056: local fmtCurrency removed. Used locale 'en' (no region), which
# renders currency as a code prefix (e.g. "USD180") instead of a symbol
# ("$180") — inconsistent with every other screen in the app, which uses
# the shared formatCurrencyCompact('en-US', ...). All call sites below
# now import and use the shared formatter directly. */
function timeOfDay() {
    const h = new Date().getHours();
    if (h < 12)
        return 'morning';
    if (h < 17)
        return 'afternoon';
    return 'evening';
}
// ─── TRIAGE ROW ───────────────────────────────────────────────
function TriageRow({ signal, isCritical, onNavigate, currency, }) {
    const sev = SEV[sevKey(signal.priority)];
    const [expanded, setExpanded] = useState(false);
    const hasTags = (signal.tags?.length ?? 0) > 0;
    return (_jsx(Box, { sx: { px: '1.25rem', py: '0.875rem', borderBottom: '1px solid var(--rule)', '&:last-child': { borderBottom: 'none' }, '&:hover': { bgcolor: 'var(--bg-2)' }, transition: 'background 0.1s' }, children: _jsxs(Box, { sx: { display: 'grid', gridTemplateColumns: onNavigate ? 'minmax(0,1fr) 90px 118px' : 'minmax(0,1fr) 90px', gap: 1.75, alignItems: 'center' }, children: [_jsxs(Box, { sx: { minWidth: 0 }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: '6px', mb: '4px' }, children: [_jsxs(Box, { sx: { display: 'inline-flex', alignItems: 'center', gap: '4px', px: '5px', py: '2px', borderRadius: '4px', bgcolor: sev.badge, flexShrink: 0 }, children: [_jsx(Box, { sx: { width: 5, height: 5, borderRadius: '50%', bgcolor: sev.color } }), _jsx(Typography, { sx: { fontSize: 10, fontWeight: 600, color: sev.color, lineHeight: 1 }, children: sev === SEV.critical ? 'Critical' : sev === SEV.watch ? 'Watch' : 'On track' })] }), _jsx(Typography, { sx: { fontSize: 13, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: signal.title })] }), _jsxs(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-3)', lineHeight: 1.45, pl: '0px' }, children: [moduleLabel(signal.module), " \u00B7 ", signal.detail] }), hasTags && (_jsxs(Box, { sx: { mt: '6px' }, children: [_jsxs(Box, { component: "button", onClick: () => setExpanded(v => !v), sx: { display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: 11, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: 'none', cursor: 'pointer', p: 0, '&:hover': { opacity: 0.8 } }, children: [expanded ? _jsx(ChevronUp, { size: 12 }) : _jsx(ChevronDown, { size: 12 }), expanded ? 'Hide' : `Show ${signal.tags.length}`, " ", signal.tags.length === 1 ? 'item' : 'items'] }), expanded && (_jsx(Box, { sx: { mt: '6px', display: 'flex', flexDirection: 'column', gap: '3px', pl: '2px' }, children: signal.tags.map(tag => (_jsxs(Typography, { sx: { fontSize: 11, fontWeight: 300, color: 'var(--ink-3)' }, children: ["\u00B7 ", tag] }, tag))) }))] }))] }), _jsxs(Box, { sx: { textAlign: 'right' }, children: [signal.revenueImpact != null && (_jsx(Typography, { sx: { fontSize: 14, fontWeight: 700, color: isCritical ? '#E5484D' : 'var(--ink)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }, children: formatCurrencyCompact(signal.revenueImpact, currency) })), signal.ageLabel && (_jsx(Typography, { sx: { fontSize: 11, fontWeight: 300, color: 'var(--ink-3)', mt: '2px' }, children: signal.ageLabel }))] }), onNavigate && (_jsx(Box, { component: "button", onClick: () => onNavigate(signal.deepLink), sx: {
                        fontSize: 12, fontWeight: 600,
                        px: '12px', py: '6px', borderRadius: '8px',
                        ...(isCritical
                            ? { bgcolor: 'var(--accent)', color: 'var(--accent-ink)', border: 'none' }
                            : { bgcolor: 'transparent', color: 'var(--ink-3)', border: '1px solid var(--rule)' }),
                        cursor: 'pointer',
                        '&:hover': { opacity: 0.88 },
                        transition: 'opacity 0.1s',
                        whiteSpace: 'nowrap',
                    }, children: actionLabel(signal) }))] }) }));
}
// ─── GROUP BAND ───────────────────────────────────────────────
function GroupBand({ sevK, count }) {
    const sev = SEV[sevK];
    return (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: '8px', px: '1.25rem', py: '8px', bgcolor: sev.bgBand, borderBottom: '1px solid var(--rule)' }, children: [_jsx(Box, { sx: { width: 8, height: 8, borderRadius: '50%', bgcolor: sev.color, flexShrink: 0 } }), _jsx(Typography, { sx: { fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', color: sev.color }, children: sev.band }), _jsxs(Typography, { sx: { ml: 'auto', fontSize: 11, fontWeight: 300, color: 'var(--ink-3)' }, children: [count, " item", count !== 1 ? 's' : ''] })] }));
}
// ─── BUSINESS PULSE SIDEBAR ───────────────────────────────────
// Cross-domain financial outcomes — distinct from Orders' Today's Flow.
// Flow = work-in-progress queues; Pulse = money realized / at-risk / stuck.
// ─── BUSINESS PULSE SIDEBAR ───────────────────────────────────
// Cross-domain financial outcomes — distinct from Orders' Today's Flow.
// Flow = work-in-progress queues; Pulse = money realized / at-risk / stuck.
// Styling mirrors the Today's Flow rail (modules UX playbook): var(--surface)
// card, uppercase micro-header, label/value rows on var(--rule) dividers,
// design tokens only — no hardcoded hex or px.
function BusinessPulse({ pulse, currency, onNavigate, noCard = false, }) {
    if (!pulse)
        return null;
    const fmt = (v) => formatCurrencyCompact(v, currency);
    const delta = pulse.revenueDeltaVsYesterday;
    const deltaLabel = delta == null
        ? undefined
        : delta === 0
            ? 'flat vs yesterday'
            : `${delta > 0 ? '▲' : '▼'} ${formatCurrencyCompact(Math.abs(Math.round(delta)), currency)} vs yesterday`;
    const deltaColor = delta == null || delta === 0
        ? 'var(--ink-4)'
        : delta > 0
            ? '#4CAF7A'
            : '#D9A23B';
    const blockLabelMap = {
        inventory: 'inventory',
        customer: 'customer',
        operational: 'fulfillment',
        none: 'none',
    };
    const blockLabel = pulse.topBlockingType && pulse.topBlockingType !== 'none'
        ? blockLabelMap[pulse.topBlockingType] ?? pulse.topBlockingType
        : null;
    const rows = [
        {
            label: 'Revenue today',
            value: fmt(pulse.revenueToday),
            color: 'var(--ink)',
            hint: deltaLabel,
            hintColor: deltaColor,
        },
        {
            label: 'Collected today',
            value: fmt(pulse.collectedRevenue),
            color: '#4CAF7A',
        },
        {
            label: 'At risk',
            value: fmt(pulse.atRiskRevenue),
            color: (pulse.atRiskRevenue ?? 0) > 0 ? '#D9A23B' : 'var(--ink)',
        },
        {
            label: 'Blocked',
            value: fmt(pulse.blockedRevenue),
            color: (pulse.blockedRevenue ?? 0) > 0 ? 'var(--accent)' : 'var(--ink)',
            hint: blockLabel ? `mostly ${blockLabel}` : undefined,
            hintColor: 'var(--ink-4)',
        },
    ];
    const pulseStages = [
        { key: 'collected', label: 'Collected', count: pulse.collectedRevenue ?? 0, color: '#4CAF7A' },
        { key: 'atRisk', label: 'At risk', count: pulse.atRiskRevenue ?? 0, color: '#D9A23B' },
        { key: 'blocked', label: 'Blocked', count: pulse.blockedRevenue ?? 0, color: 'var(--accent)' },
    ];
    const activeStages = pulseStages.filter(s => s.count > 0);
    const stageTotal = activeStages.reduce((s, d) => s + d.count, 0) || 1;
    const cardSx = noCard
        ? {}
        : {
            flex: { xs: '1 1 auto', lg: '0 0 280px' },
            width: { xs: '100%', lg: '280px' },
            minWidth: 0,
            boxSizing: 'border-box',
            bgcolor: 'var(--surface)',
            border: '0.5px solid var(--rule)',
            borderRadius: '14px',
            p: '18px 20px',
        };
    return (_jsxs(Box, { sx: cardSx, children: [_jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.875 }, children: "Business pulse" }), rows.map(({ label, value, color, hint, hintColor }) => (_jsxs(Box, { sx: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', py: 1.125, borderBottom: '1px solid var(--rule)' }, children: [_jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }, children: label }), hint && (_jsx(Typography, { sx: { fontSize: 11, fontWeight: 300, color: hintColor ?? 'var(--ink-4)', mt: 0.25 }, children: hint }))] }), _jsx(Typography, { sx: { fontSize: 15, fontWeight: 600, color }, children: value })] }, label))), _jsx(Box, { sx: { display: 'flex', height: 6, borderRadius: '3px', overflow: 'hidden', mt: 2, mb: 2, bgcolor: 'var(--bg)' }, children: activeStages.map(stage => (_jsx(Box, { sx: { width: `${(stage.count / stageTotal) * 100}%`, bgcolor: stage.color } }, stage.key))) }), onNavigate && (_jsx(Box, { onClick: () => onNavigate('/orders/flow'), sx: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', mt: 1.5, px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }, children: "View order flow \u2192" }))] }));
}
// ─── MERGED PULSE CARD ────────────────────────────────────────
// Right-hand 25% card for the map layout. Combines ranked decisions
// (top 3, +N more → /order-flow) with the BusinessPulse stats strip.
// Decisions section self-hides when signals are empty (calm state).
function MergedPulseCard({ criticalSignals, watchSignals, pulse, currency, onNavigate, generatedTime, trustWarning, onRefreshBrief, }) {
    const urgentSignals = [...criticalSignals, ...watchSignals];
    const visibleSignals = urgentSignals.slice(0, 3);
    const hiddenCount = Math.max(0, urgentSignals.length - 3);
    return (_jsxs(Box, { sx: {
            flex: { xs: '1 1 auto', lg: '0 0 280px' },
            width: { xs: '100%', lg: '280px' },
            minWidth: 0,
            boxSizing: 'border-box',
            bgcolor: 'var(--surface)',
            border: '0.5px solid var(--rule)',
            borderRadius: '14px',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            height: { xs: 'auto', lg: '100%' },
        }, children: [urgentSignals.length > 0 && (_jsxs(Box, { sx: { px: '1.25rem', pt: '1rem', pb: '0.75rem' }, children: [_jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: '0.625rem' }, children: "Needs a decision" }), visibleSignals.map(s => (_jsxs(Box, { onClick: () => s.deepLink && onNavigate?.(s.deepLink), sx: { display: 'flex', alignItems: 'flex-start', gap: '8px', py: '6px', cursor: s.deepLink ? 'pointer' : 'default', '&:hover': s.deepLink ? { opacity: 0.8 } : {} }, children: [_jsx(Box, { sx: { width: 7, height: 7, borderRadius: '50%', bgcolor: s.priority <= 2 ? '#E5484D' : '#D9A23B', mt: '5px', flexShrink: 0 } }), _jsxs(Box, { sx: { flex: 1, minWidth: 0 }, children: [_jsx(Typography, { sx: { fontSize: 12, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.3 }, noWrap: true, children: s.title }), s.revenueImpact != null && (_jsx(Typography, { sx: { fontSize: 11, fontWeight: 300, color: 'var(--ink-3)' }, children: formatCurrencyCompact(s.revenueImpact, currency) }))] })] }, s.id))), hiddenCount > 0 && (_jsxs(Box, { onClick: () => onNavigate?.('/order-flow'), sx: { display: 'inline-flex', alignItems: 'center', gap: '4px', mt: '4px', fontSize: 11, fontWeight: 500, color: 'var(--accent)', cursor: 'pointer', '&:hover': { opacity: 0.75 } }, children: ["+", hiddenCount, " more \u2192"] }))] })), urgentSignals.length > 0 && pulse && (_jsx(Box, { sx: { height: '0.5px', bgcolor: 'var(--rule)' } })), pulse && (_jsx(Box, { sx: { px: '18px', py: '14px', flex: 1 }, children: _jsx(BusinessPulse, { pulse: pulse, currency: currency, onNavigate: onNavigate, noCard: true }) })), _jsxs(Box, { sx: { px: '1.25rem', py: '0.625rem', bgcolor: 'var(--bg-2)', borderTop: '0.5px solid var(--rule)', display: 'flex', alignItems: 'center', gap: '8px' }, children: [trustWarning && (_jsx(Typography, { sx: { fontSize: 11, fontWeight: 300, color: '#D9A23B' }, children: "Data may be stale \u00B7" })), _jsx(Typography, { sx: { fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }, children: generatedTime ? `Updated at ${generatedTime}` : 'Updating…' }), onRefreshBrief && (_jsx(Box, { component: "button", onClick: onRefreshBrief, sx: { ml: 'auto', display: 'flex', alignItems: 'center', gap: '4px', fontSize: 11, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: 'none', cursor: 'pointer', p: 0, '&:hover': { opacity: 0.75 } }, children: _jsx(RefreshCw, { size: 11 }) }))] })] }));
}
// ─── MAIN COMPONENT ───────────────────────────────────────────
function OverviewModuleFT2Inner(props) {
    const { morningBrief, pulse, onNavigate, onRefreshBrief, onExportBrief, mapContent, upgradeTeaser, } = props;
    const isLoading = morningBrief === undefined;
    const isTrustGated = morningBrief === null;
    const signals = morningBrief?.signals ?? [];
    const greeting = morningBrief?.greeting ?? null;
    const summaryLine = morningBrief?.summaryLine ?? null;
    const generatedAt = morningBrief?.generatedAt ?? null;
    const trustWarning = morningBrief?.trustWarning ?? false;
    const currency = props.currency ?? 'USD';
    const criticalSignals = signals.filter(s => s.priority <= 2);
    const watchSignals = signals.filter(s => s.priority === 3 || s.priority === 4);
    const onTrackSignals = signals.filter(s => s.priority === 5);
    const [criticalExpanded, setCriticalExpanded] = useState(false);
    const [watchExpanded, setWatchExpanded] = useState(false);
    const visibleCriticalSignals = criticalSignals.slice(0, TRIAGE_PREVIEW_LIMIT);
    const hiddenCriticalSignals = criticalSignals.slice(TRIAGE_PREVIEW_LIMIT);
    const visibleWatchSignals = watchSignals.slice(0, TRIAGE_PREVIEW_LIMIT);
    const hiddenWatchSignals = watchSignals.slice(TRIAGE_PREVIEW_LIMIT);
    const generatedTime = generatedAt
        ? new Date(generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : null;
    const brandGreen = '#1D9E75';
    const greetingText = props.userName
        ? `Good ${timeOfDay()}, ${props.userName}.`
        : (greeting ?? `Good ${timeOfDay()}.`);
    const subText = (() => {
        if (isLoading)
            return null;
        if (isTrustGated)
            return 'Your morning brief will appear here once your first sync completes.';
        const urgent = criticalSignals.length + watchSignals.length;
        if (!urgent)
            return summaryLine ?? 'All operations are on track.';
        const atStake = pulse?.blockedRevenue
            ? ` · ${formatCurrencyCompact(Number(pulse.blockedRevenue), currency)} at stake`
            : '';
        return `${urgent} decision${urgent !== 1 ? 's' : ''} pending ${atStake} — everything else is on track.`;
    })();
    return (_jsxs(Box, { sx: { p: { xs: 2, md: '28px 32px' }, display: 'flex', flexDirection: 'column', gap: '20px', bgcolor: 'var(--bg)', minHeight: '100%' }, children: [_jsxs(Box, { children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: '10px', flexWrap: 'wrap', gap: 1 }, children: [_jsxs(Typography, { sx: { fontSize: 10.5, fontWeight: 500, color: brandGreen, textTransform: 'uppercase', letterSpacing: '0.12em', lineHeight: 2 }, children: [new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }), ' · ', isLoading ? 'Syncing…' : 'Live'] }), !isLoading && !isTrustGated && onExportBrief && (_jsx(Box, { onClick: onExportBrief, sx: { display: 'inline-flex', alignItems: 'center', px: '12px', py: '6px', fontSize: 12, fontWeight: 500, color: 'var(--accent)', border: '0.5px solid var(--accent-border)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }, children: "Export brief \u2192" }))] }), isLoading ? (_jsxs(_Fragment, { children: [_jsx(Skeleton, { width: "52%", height: 38, sx: { mb: '8px' } }), _jsx(Skeleton, { width: "72%", height: 18 })] })) : isTrustGated ? (_jsxs(_Fragment, { children: [_jsx(Typography, { sx: { fontSize: 22, fontWeight: 700, color: 'var(--ink)', mb: '8px', lineHeight: 1.2, letterSpacing: '-0.01em' }, children: "Setting things up" }), _jsx(Typography, { sx: { fontSize: 13, fontWeight: 300, color: 'var(--ink-3)', lineHeight: 1.6 }, children: subText })] })) : (_jsxs(_Fragment, { children: [_jsx(Typography, { sx: { fontSize: 32, fontWeight: 700, color: 'var(--ink)', mb: '8px', lineHeight: 1.1, letterSpacing: '-0.02em' }, children: greetingText }), _jsx(Typography, { sx: { fontSize: 13, fontWeight: 300, color: 'var(--ink-3)', lineHeight: 1.6 }, children: subText })] }))] }), !isLoading && (mapContent ? (
            /* MAP LAYOUT — 75% live map + 25% merged pulse card */
            _jsxs(Box, { sx: {
                    display: 'flex',
                    flexDirection: { xs: 'column', lg: 'row' },
                    gap: 2.25,
                    alignItems: 'stretch',
                }, children: [_jsx(Box, { sx: {
                            flex: '1 1 0',
                            width: { xs: '100%', lg: 'auto' },
                            minWidth: 0,
                        }, children: mapContent }), _jsx(MergedPulseCard, { criticalSignals: criticalSignals, watchSignals: watchSignals, pulse: pulse ?? null, currency: currency, onNavigate: onNavigate, generatedTime: generatedTime, trustWarning: trustWarning, onRefreshBrief: onRefreshBrief })] })) : (
            /* TRIAGE LAYOUT — fallback for non-scale tier and zero-zone tenants */
            _jsxs(Box, { sx: {
                    display: 'flex',
                    flexDirection: { xs: 'column', lg: 'row' },
                    flexWrap: { xs: 'nowrap', lg: 'wrap' },
                    gap: 2.25,
                    alignItems: 'stretch',
                }, children: [_jsxs(Box, { sx: {
                            flex: { xs: '1 1 auto', lg: '1 1 0' },
                            width: { xs: '100%', lg: 'auto' },
                            minWidth: 0,
                            boxSizing: 'border-box',
                            bgcolor: 'var(--surface)',
                            border: '0.5px solid var(--rule)',
                            borderRadius: '14px',
                            overflow: 'hidden',
                            display: 'flex',
                            flexDirection: 'column',
                        }, children: [_jsxs(Box, { sx: { px: '1.25rem', py: '0.9rem', borderBottom: '0.5px solid var(--rule)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }, children: [_jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 14, fontWeight: 500, color: 'var(--ink)', lineHeight: 1 }, children: isTrustGated ? 'Getting ready' : 'Needs a decision' }), !isTrustGated && (_jsx(Typography, { sx: { fontSize: 11, fontWeight: 300, color: 'var(--ink-3)', mt: '3px' }, children: "Ranked by commercial consequence" }))] }), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: '10px' }, children: [_jsx(Typography, { sx: { fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }, children: generatedTime ? `Updated ${generatedTime}` : 'Updating…' }), onRefreshBrief && (_jsx(Box, { component: "button", onClick: onRefreshBrief, sx: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: 11, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: 'none', cursor: 'pointer', p: 0, '&:hover': { opacity: 0.75 } }, children: _jsx(RefreshCw, { size: 11 }) }))] })] }), isTrustGated && (_jsx(Box, { sx: { px: '1.25rem', py: '2rem', textAlign: 'center' }, children: _jsx(Typography, { sx: { fontSize: 13, fontWeight: 300, color: 'var(--ink-3)', lineHeight: 1.6 }, children: "Waiting for your first data sync. This usually takes a few minutes." }) })), !isTrustGated && signals.length === 0 && (_jsxs(Box, { sx: { px: '1.25rem', py: '1.5rem', display: 'flex', alignItems: 'center', gap: '8px' }, children: [_jsx(Box, { sx: { width: 8, height: 8, borderRadius: '50%', bgcolor: '#4CAF7A', flexShrink: 0 } }), _jsx(Typography, { sx: { fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }, children: "All operations are on track \u2014 no decisions required" })] })), criticalSignals.length > 0 && (_jsxs(_Fragment, { children: [_jsx(GroupBand, { sevK: "critical", count: criticalSignals.length }), visibleCriticalSignals.map(s => (_jsx(TriageRow, { signal: s, isCritical: true, onNavigate: onNavigate, currency: currency }, s.id))), hiddenCriticalSignals.length > 0 && (_jsxs(_Fragment, { children: [_jsx(Collapse, { in: criticalExpanded, timeout: 180, unmountOnExit: true, children: hiddenCriticalSignals.map(s => (_jsx(TriageRow, { signal: s, isCritical: true, onNavigate: onNavigate, currency: currency }, s.id))) }), _jsxs(Box, { onClick: () => setCriticalExpanded(v => !v), sx: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, px: '1.25rem', py: '10px', borderBottom: '0.5px solid var(--rule)', cursor: 'pointer', color: 'var(--accent)', '&:hover': { opacity: 0.75 } }, children: [_jsx(Typography, { sx: { fontSize: 11, fontWeight: 500 }, children: criticalExpanded ? 'Show less' : `See ${hiddenCriticalSignals.length} more` }), criticalExpanded ? _jsx(ChevronUp, { size: 13 }) : _jsx(ChevronDown, { size: 13 })] })] }))] })), watchSignals.length > 0 && (_jsxs(_Fragment, { children: [_jsx(GroupBand, { sevK: "watch", count: watchSignals.length }), visibleWatchSignals.map(s => (_jsx(TriageRow, { signal: s, isCritical: false, onNavigate: onNavigate, currency: currency }, s.id))), hiddenWatchSignals.length > 0 && (_jsxs(_Fragment, { children: [_jsx(Collapse, { in: watchExpanded, timeout: 180, unmountOnExit: true, children: hiddenWatchSignals.map(s => (_jsx(TriageRow, { signal: s, isCritical: false, onNavigate: onNavigate, currency: currency }, s.id))) }), _jsxs(Box, { onClick: () => setWatchExpanded(v => !v), sx: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, px: '1.25rem', py: '10px', borderBottom: '0.5px solid var(--rule)', cursor: 'pointer', color: 'var(--accent)', '&:hover': { opacity: 0.75 } }, children: [_jsx(Typography, { sx: { fontSize: 11, fontWeight: 500 }, children: watchExpanded ? 'Show less' : `See ${hiddenWatchSignals.length} more` }), watchExpanded ? _jsx(ChevronUp, { size: 13 }) : _jsx(ChevronDown, { size: 13 })] })] }))] })), onTrackSignals.length > 0 && (_jsx(EverythingElse, { signals: onTrackSignals, onNavigate: onNavigate, currency: currency })), _jsxs(Box, { sx: {
                                    mt: 'auto',
                                    px: '1.25rem',
                                    py: '0.625rem',
                                    bgcolor: 'var(--bg-2)',
                                    borderTop: '0.5px solid var(--rule)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                }, children: [trustWarning && (_jsx(Typography, { sx: { fontSize: 11, fontWeight: 300, color: '#D9A23B' }, children: "Data may be stale \u00B7" })), _jsx(Typography, { sx: { fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }, children: generatedTime ? `Updated at ${generatedTime}` : 'Updating…' })] })] }), pulse && _jsx(BusinessPulse, { pulse: pulse, currency: currency, onNavigate: onNavigate }), upgradeTeaser && (_jsx(Box, { sx: { flex: '1 0 100%', minWidth: 0 }, children: upgradeTeaser }))] }))), isLoading && (_jsxs(Box, { sx: { display: 'flex', flexWrap: 'wrap', gap: 2.25, alignItems: 'start' }, children: [_jsx(Box, { sx: { flex: '1 0 300px', minWidth: 0, bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', p: '1.25rem', display: 'flex', flexDirection: 'column', gap: '12px' }, children: [1, 2, 3].map(i => _jsx(Skeleton, { height: 56, sx: { borderRadius: '8px' } }, i)) }), _jsx(Box, { sx: { flex: '0 0 300px', bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', p: '1.25rem', display: 'flex', flexDirection: 'column', gap: '12px' }, children: [1, 2, 3, 4].map(i => _jsx(Skeleton, { height: 24, sx: { borderRadius: '4px' } }, i)) })] }))] }));
}
// ─── EVERYTHING ELSE (collapsible on-track section) ───────────
function EverythingElse({ signals, onNavigate, currency, }) {
    const [open, setOpen] = useState(false);
    return (_jsxs(_Fragment, { children: [_jsxs(Box, { onClick: () => setOpen(v => !v), sx: { display: 'flex', alignItems: 'center', gap: '8px', px: '1.25rem', py: '8px', bgcolor: SEV.ontrack.bgBand, borderBottom: open ? '1px solid var(--rule)' : 'none', cursor: 'pointer', '&:hover': { opacity: 0.85 }, transition: 'opacity 0.1s' }, children: [_jsx(Box, { sx: { width: 8, height: 8, borderRadius: '50%', bgcolor: '#4CAF7A', flexShrink: 0 } }), _jsx(Typography, { sx: { fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#4CAF7A' }, children: "Everything else" }), _jsxs(Typography, { sx: { fontSize: 11, fontWeight: 300, color: 'var(--ink-3)', ml: '4px' }, children: [signals.length, " on track"] }), _jsx(Box, { sx: { ml: 'auto' }, children: open ? _jsx(ChevronUp, { size: 13, color: "var(--ink-4)" }) : _jsx(ChevronDown, { size: 13, color: "var(--ink-4)" }) })] }), open && signals.map(s => (_jsx(TriageRow, { signal: s, isCritical: false, onNavigate: onNavigate, currency: currency }, s.id)))] }));
}
// ─── EXPORT ───────────────────────────────────────────────────
export default function OverviewModuleFT2(props) {
    return (_jsx(ModuleErrorBoundary, { moduleName: "overview", children: _jsx(OverviewModuleFT2Inner, { ...props }) }));
}
//# sourceMappingURL=OverviewModuleFT2.js.map