import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// modules/customers/src/ui/pages/CustomersModuleFT2.tsx
import { memo } from 'react';
import { Box, Typography, useTheme, Chip } from '@mui/material';
import { ModuleLoadingSkeleton } from '@lasyncro/shared/ui';
import { Users, TrendingUp, AlertTriangle, Star } from 'lucide-react';
import { formatCurrencyCompact } from '@lasyncro/shared/ui';
import { ModuleErrorBoundary } from '@lasyncro/shared/ui';
const TIER_COLORS = {
    VIP: '#7C3AED',
    CORE: '#2563EB',
    NEW: '#16A34A',
    AT_RISK: '#CA8A04',
    LOST: '#DC2626',
};
const CHURN_LABELS = {
    low: 'Low risk',
    medium: 'Medium risk',
    high: 'High risk',
};
function StatBox({ label, value, icon, color, }) {
    return (_jsxs(Box, { sx: {
            flex: 1,
            p: 2.5,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            minWidth: 140,
        }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, mb: 1, color: color ?? 'text.secondary' }, children: [icon, _jsx(Typography, { variant: "caption", color: "inherit", children: label })] }), _jsx(Typography, { variant: "h5", fontWeight: 700, sx: { color: color ?? 'text.primary', fontVariantNumeric: 'tabular-nums' }, children: value })] }));
}
const CustomerRow = memo(function CustomerRow({ customer, currency }) {
    const theme = useTheme();
    const fmt = (n) => formatCurrencyCompact(n, currency?.displayCurrency, currency?.locale, currency?.rates);
    const churnColor = customer.churn_risk === 'low'
        ? theme.palette.success.main
        : customer.churn_risk === 'medium'
            ? theme.palette.warning.main
            : theme.palette.error.main;
    const shortId = customer.customer_hashed_id.slice(0, 8).toUpperCase();
    return (_jsxs(Box, { sx: {
            display: 'grid',
            gridTemplateColumns: '1.5fr 1fr 1fr 1fr 1fr 1fr',
            px: 2,
            py: 1.5,
            borderBottom: '1px solid',
            borderColor: 'divider',
            alignItems: 'center',
            '&:hover': { bgcolor: 'action.hover' },
        }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1 }, children: [_jsx(Chip, { label: customer.customer_tier, size: "small", sx: {
                            bgcolor: TIER_COLORS[customer.customer_tier] ?? theme.palette.primary.main,
                            color: '#fff',
                            fontWeight: 700,
                            fontSize: 10,
                            height: 20,
                        } }), _jsx(Typography, { variant: "body2", sx: { fontFamily: 'monospace', fontSize: 11 }, children: shortId })] }), _jsx(Typography, { variant: "body2", children: customer.total_orders }), _jsx(Typography, { variant: "body2", fontWeight: 600, children: fmt(customer.total_revenue) }), _jsx(Typography, { variant: "body2", children: fmt(customer.avg_order_value) }), _jsx(Typography, { variant: "body2", children: customer.days_since_last_order != null
                    ? `${customer.days_since_last_order}d ago`
                    : '—' }), _jsx(Typography, { variant: "caption", sx: { color: churnColor, fontWeight: 600 }, children: CHURN_LABELS[customer.churn_risk] })] }));
});
function CustomersModuleFT2Inner({ ltv, currency }) {
    const theme = useTheme();
    const fmt = (n) => formatCurrencyCompact(n, currency?.displayCurrency, currency?.locale, currency?.rates);
    const summary = ltv?.summary;
    const customers = ltv?.customers ?? [];
    return (_jsxs(Box, { sx: { p: 3 }, children: [_jsxs(Box, { sx: { mb: 3 }, children: [_jsx(Typography, { variant: "h5", fontWeight: 700, children: "Customers" }), _jsx(Typography, { variant: "body2", color: "text.secondary", sx: { mt: 0.5 }, children: "Lifetime value, order frequency, and churn intelligence \u2014 anonymous, PII-free." })] }), !ltv && _jsx(ModuleLoadingSkeleton, {}), summary && (_jsxs(_Fragment, { children: [_jsxs(Box, { sx: { display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }, children: [_jsx(StatBox, { label: "Total Customers", value: String(summary.total_customers), icon: _jsx(Users, { size: 14 }) }), _jsx(StatBox, { label: "Avg Lifetime Value", value: fmt(summary.avg_ltv), icon: _jsx(TrendingUp, { size: 14 }), color: theme.palette.primary.main }), _jsx(StatBox, { label: "Avg Order Frequency", value: `${summary.avg_order_frequency} orders`, icon: _jsx(TrendingUp, { size: 14 }) }), _jsx(StatBox, { label: "VIP Customers", value: String(summary.vip_count), icon: _jsx(Star, { size: 14 }), color: "#7C3AED" }), _jsx(StatBox, { label: "At Risk", value: String(summary.at_risk_count), icon: _jsx(AlertTriangle, { size: 14 }), color: theme.palette.warning.main })] }), (summary.at_risk_count > 0 || summary.lost_count > 0) && (() => {
                        const atRiskCustomers = customers
                            .filter(c => c.customer_tier === 'AT_RISK' || c.customer_tier === 'LOST')
                            .slice(0, 5);
                        return (_jsxs(Box, { sx: {
                                mb: 3,
                                border: '1px solid',
                                borderColor: theme.palette.warning.main,
                                borderRadius: 2,
                                overflow: 'hidden',
                            }, children: [_jsxs(Box, { sx: {
                                        px: 2, py: 1.5,
                                        bgcolor: theme.palette.mode === 'dark'
                                            ? 'rgba(202,138,4,0.12)'
                                            : 'rgba(202,138,4,0.06)',
                                        borderBottom: '1px solid',
                                        borderColor: theme.palette.warning.main,
                                        display: 'flex', alignItems: 'center', gap: 1,
                                    }, children: [_jsx(AlertTriangle, { size: 14, color: theme.palette.warning.main }), _jsxs(Typography, { variant: "caption", fontWeight: 700, color: "warning.main", children: [summary.at_risk_count + summary.lost_count, " high-value customers need attention"] }), _jsx(Typography, { variant: "caption", color: "text.secondary", sx: { ml: 'auto' }, children: "No order in 90+ days" })] }), atRiskCustomers.map(c => (_jsxs(Box, { sx: {
                                        display: 'grid',
                                        gridTemplateColumns: '1fr 1fr 1fr 1fr',
                                        px: 2, py: 1.25,
                                        borderBottom: '1px solid',
                                        borderColor: 'divider',
                                        alignItems: 'center',
                                        '&:last-child': { borderBottom: 'none' },
                                    }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1 }, children: [_jsx(Box, { sx: {
                                                        width: 8, height: 8, borderRadius: '50%',
                                                        bgcolor: c.customer_tier === 'LOST'
                                                            ? theme.palette.error.main
                                                            : theme.palette.warning.main,
                                                    } }), _jsx(Typography, { variant: "caption", sx: { fontFamily: 'monospace' }, children: c.customer_hashed_id.slice(0, 8).toUpperCase() })] }), _jsxs(Typography, { variant: "caption", fontWeight: 600, children: [fmt(c.total_revenue), " LTV"] }), _jsx(Typography, { variant: "caption", color: "text.secondary", children: c.days_since_last_order != null ? `${c.days_since_last_order}d ago` : '—' }), _jsx(Box, { sx: {
                                                display: 'inline-flex',
                                                bgcolor: c.customer_tier === 'LOST'
                                                    ? theme.palette.error.main
                                                    : theme.palette.warning.main,
                                                color: '#fff',
                                                borderRadius: '4px',
                                                px: '6px', py: '2px',
                                                width: 'fit-content',
                                            }, children: _jsx(Typography, { sx: { fontSize: 10, fontWeight: 700 }, children: c.customer_tier }) })] }, c.customer_hashed_id)))] }));
                    })(), customers.length > 0 && (_jsxs(Box, { children: [_jsx(Typography, { variant: "overline", color: "text.secondary", sx: { mb: 1.5, display: 'block' }, children: "Customers \u2014 ranked by lifetime value" }), _jsx(Box, { sx: {
                                    display: 'grid',
                                    gridTemplateColumns: '1.5fr 1fr 1fr 1fr 1fr 1fr',
                                    px: 2,
                                    py: 1,
                                    borderBottom: '1px solid',
                                    borderColor: 'divider',
                                }, children: ['Customer', 'Orders', 'LTV', 'Avg Order', 'Last Order', 'Churn Risk'].map(h => (_jsx(Typography, { variant: "caption", color: "text.secondary", fontWeight: 600, children: h }, h))) }), customers.map(c => (_jsx(CustomerRow, { customer: c, currency: currency }, c.customer_hashed_id)))] })), customers.length === 0 && (_jsx(Box, { sx: { py: 4, textAlign: 'center', border: '1px solid', borderColor: 'divider', borderRadius: 2 }, children: _jsx(Typography, { variant: "body2", color: "text.secondary", children: "No registered customer orders found. Guest checkouts are excluded by design." }) }))] }))] }));
}
export default function CustomersModuleFT2(props) {
    return _jsx(ModuleErrorBoundary, { moduleName: "customers", children: _jsx(CustomersModuleFT2Inner, { ...props }) });
}
//# sourceMappingURL=CustomersModuleFT2.js.map