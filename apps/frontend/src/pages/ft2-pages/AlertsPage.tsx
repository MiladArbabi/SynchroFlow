// apps/frontend/src/pages/ft2-pages/AlertsPage.tsx
import { Box, Typography, Chip, IconButton, Divider, CircularProgress, Alert as MuiAlert } from '@mui/material';
import { X, AlertTriangle, AlertCircle, Info, ArrowRight } from 'lucide-react';
import { useAlerts, useDismissAlert, type Alert } from '../alerts/useAlerts';
import { useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import AlertRulesPanel from 'components/AlertRulesPanel';
import PlanGate from '../../components/PlanGate';

/**
 * ALERTS INBOX PAGE (AL-04)
 * -------------------------
 * Ranked operator alert inbox — the daily engagement surface.
 *
 * Design rules (UX Consortium):
 * - Operator vocabulary — no system language
 * - Calm authority — not alarming, informative
 * - Dismissible — operator controls their inbox
 * - Auto-resolves — stale alerts disappear automatically
 * - Revenue-ranked — highest commercial impact first
 */

function SeverityIcon({ severity }: { severity: Alert['severity'] }) {
  const theme = useTheme();
  const size = 16;

  if (severity === 'critical') {
    return <AlertCircle size={size} color={theme.palette.error.main} />;
  }
  if (severity === 'warning') {
    return <AlertTriangle size={size} color={theme.palette.warning.main} />;
  }
  return <Info size={size} color={theme.palette.primary.main} />;
}

function AlertCard({ alert, onDismiss }: { alert: Alert; onDismiss: (id: string) => void }) {
  const theme = useTheme();
  const navigate = useNavigate();

  const ALERT_TYPE_ROUTES: Record<string, string> = {
    // WMS
    wms_pick_exception:       '/problem-center',
    wms_pack_exception:       '/problem-center',
    wms_stow_pending:         '/wms',
    wms_batch_ready_to_pack:  '/wms',
    wms_batch_ready_to_ship:  '/wms',
    wms_operator_idle:        '/wms',
    // Demand
    stockout_risk:            '/demand',
    reorder_warning:          '/demand',
    // Cash flow
    revenue_at_risk:          '/cash-flow',
    // Order nexus
    operational:              '/orders',
    sla_breach:               '/orders',
  };

  const ALERT_TYPE_LABELS: Record<string, string> = {
    wms_pick_exception:       'Problem Center',
    wms_pack_exception:       'Problem Center',
    wms_stow_pending:         'Warehouse',
    wms_batch_ready_to_pack:  'Warehouse',
    wms_batch_ready_to_ship:  'Warehouse',
    wms_operator_idle:        'Warehouse',
    stockout_risk:            'Demand',
    reorder_warning:          'Demand',
    revenue_at_risk:          'Cash Flow',
    operational:              'Orders',
    sla_breach:               'Orders',
  };

  const deepLinkRoute = ALERT_TYPE_ROUTES[alert.alert_type];

  const borderColor =
    alert.severity === 'critical'
      ? theme.palette.error.main
      : alert.severity === 'warning'
      ? theme.palette.warning.main
      : theme.palette.primary.main;

  const revenue = alert.revenue_impact
    ? `$${Math.round(Number(alert.revenue_impact)).toLocaleString()}`
    : null;

  return (
    <Box
      sx={{
        p: 2,
        border: '1px solid',
        borderColor: 'divider',
        borderLeft: `4px solid ${borderColor}`,
        borderRadius: 1.5,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.5,
      }}
    >
      {/* SEVERITY ICON */}
      <Box sx={{ pt: 0.3, flexShrink: 0 }}>
        <SeverityIcon severity={alert.severity} />
      </Box>

      {/* CONTENT */}
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <Typography variant="body2" fontWeight={600}>
            {alert.title}
          </Typography>
          {revenue && (
            <Chip
              label={revenue}
              size="small"
              variant="outlined"
              sx={{ fontSize: 11, height: 20 }}
            />
          )}
        </Box>
        <Typography variant="caption" color="text.secondary">
          {alert.message}
        </Typography>

        {/* DEEP LINK */}
        {deepLinkRoute && (
          <Box sx={{ mt: 1 }}>
            <Typography
              variant="caption"
              color="primary"
              sx={{
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                fontWeight: 600,
                '&:hover': { textDecoration: 'underline' },
              }}
              onClick={() => navigate(deepLinkRoute)}
            >
              Go to {ALERT_TYPE_LABELS[alert.alert_type] ?? 'module'}
              <ArrowRight size={12} />
            </Typography>
          </Box>
        )}
      </Box>

      {/* DISMISS */}
      <IconButton
        size="small"
        onClick={() => onDismiss(alert.id)}
        sx={{ flexShrink: 0, mt: -0.5 }}
      >
        <X size={14} />
      </IconButton>
    </Box>
  );
}

export default function AlertsPage() {
  const { data, isLoading, isError } = useAlerts();
  const { mutate: dismiss } = useDismissAlert();

  const alerts = data?.data ?? [];

  const critical = alerts.filter(a => a.severity === 'critical');
  const warning = alerts.filter(a => a.severity === 'warning');
  const info = alerts.filter(a => a.severity === 'info');

  return (
    <Box sx={{ p: 3, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 3, alignItems: 'start' }}>
      <Box>
        {/* HEADER */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h5" fontWeight={700}>
            Alerts
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            System-generated signals ranked by urgency and commercial impact.
          </Typography>
        </Box>

        {/* LOADING */}
        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
            <CircularProgress size={24} />
          </Box>
        )}

        {/* ERROR */}
        {isError && (
          <MuiAlert severity="error" sx={{ mb: 3 }}>
            Failed to load alerts. Please refresh.
          </MuiAlert>
        )}

        {/* EMPTY STATE */}
        {!isLoading && !isError && alerts.length === 0 && (
          <Box
            sx={{
              p: 4,
              textAlign: 'center',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
            }}
          >
            <Typography variant="body1" fontWeight={600}>
              No active alerts
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Your operations are running smoothly. Alerts will appear here when action is needed.
            </Typography>
          </Box>
        )}

        {/* CRITICAL */}
        {critical.length > 0 && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="overline" color="error.main" sx={{ mb: 1.5, display: 'block' }}>
              Critical — {critical.length}
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {critical.map(alert => (
                <AlertCard key={alert.id} alert={alert} onDismiss={dismiss} />
              ))}
            </Box>
          </Box>
        )}

        {/* DIVIDER */}
        {critical.length > 0 && warning.length > 0 && (
          <Divider sx={{ mb: 3 }} />
        )}

        {/* WARNING */}
        {warning.length > 0 && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="overline" color="warning.main" sx={{ mb: 1.5, display: 'block' }}>
              Warnings — {warning.length}
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {warning.map(alert => (
                <AlertCard key={alert.id} alert={alert} onDismiss={dismiss} />
              ))}
            </Box>
          </Box>
        )}

        {/* INFO */}
        {info.length > 0 && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="overline" color="primary.main" sx={{ mb: 1.5, display: 'block' }}>
              Info — {info.length}
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {info.map(alert => (
                <AlertCard key={alert.id} alert={alert} onDismiss={dismiss} />
              ))}
            </Box>
          </Box>
        )}

        </Box>
        {/* Alert rule configuration — Growth tier and above only */}
        <PlanGate feature="alerts.rules">
          <AlertRulesPanel />
        </PlanGate>
    </Box>
  );
}