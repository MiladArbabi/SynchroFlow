// apps/frontend/src/pages/ft2-pages/AlertsPage.tsx

/**
 * ALERTS MODULE — FT2 WORKING SURFACE
 * =====================================
 * Blueprint ref: docs/blueprints/AlertsModule.md
 * Sprint cover: ALR-02 through ALR-12 (full rebuild)
 *
 * Key decisions baked in:
 * - D1 : consequence taxonomy is default view; severity is a toggle
 * - D5 : severity = rail + icon + label, never colour alone
 * - KI-1: deep links entity-aware (alert_type underscore keys + entity_id)
 * - KI-2: dismiss retired; lifecycle = Acknowledge / Snooze / Resolve
 * - KI-3: pre-FT2 (700 weight, 1px borders, raw MUI) fully replaced
 *
 * Design system: useAppTheme() CSS vars exclusively — zero hardcoded hex.
 */

import { useState, useMemo } from 'react';
import {
  Box, Typography, Chip, Menu, MenuItem, Skeleton, Collapse,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  AlertCircle, AlertTriangle, Info,
  TrendingDown, Package, DollarSign, Truck, Warehouse, ShieldAlert,
  Bell, CheckCircle2, Clock, ChevronDown, ChevronRight,
  ArrowRight, Filter, RotateCcw, LayoutGrid, ListFilter, X,
} from 'lucide-react';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useAuth } from 'contexts/AuthContext';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import AlertRulesPanel from 'components/AlertRulesPanel';
import {
  useAlerts, useAcknowledgeAlert, useSnoozeAlert, useResolveAlert,
  type Alert, type AlertCategory, type AlertFilters, type AlertStatus,
} from '../alerts/useAlerts';

// ─── MODULE TAB BAR CONFIG (blueprint §3) ─────────────────────────────────────

const ALERTS_TABS = [
  { id: 'inbox',    label: 'Inbox',    path: '/alerts' },
  { id: 'snoozed',  label: 'Snoozed',  path: '/alerts/snoozed' },
  { id: 'resolved', label: 'Resolved', path: '/alerts/resolved' },
  {
    id: 'rules', label: 'Rules', path: '/alerts/rules',
    feature: 'alerts.rules' as const,
    // ModuleTabBar will lock this tab + show upgrade prompt for sub-growth tiers
  },
];

// ─── CONSEQUENCE TAXONOMY (blueprint §6) ──────────────────────────────────────

const CATEGORY_ORDER: (AlertCategory | 'uncategorized')[] = [
  'revenue_at_risk', 'stock_reorder', 'money_margin',
  'supplier_inbound', 'warehouse_floor', 'data_trust', 'uncategorized',
];

const CATEGORY_CONFIG: Record<AlertCategory | 'uncategorized', {
  label: string;
  icon: React.ElementType;
}> = {
  revenue_at_risk:  { label: 'Revenue at risk',    icon: TrendingDown },
  stock_reorder:    { label: 'Stock & reorder',    icon: Package },
  money_margin:     { label: 'Money & margin',     icon: DollarSign },
  supplier_inbound: { label: 'Supplier & inbound', icon: Truck },
  warehouse_floor:  { label: 'Warehouse floor',    icon: Warehouse },
  data_trust:       { label: 'Data trust',          icon: ShieldAlert },
  uncategorized:    { label: 'Other',               icon: Bell },
};

// ─── DEEP LINK ROUTING (KI-1 fix) ─────────────────────────────────────────────
// alert_type is always underscore-delimited (set by all producers).
// alert_key is colon-delimited and was the source of the original mismatch.
// Entity-aware: appends entity_id where the destination UI can consume it.

const ALERT_ROUTE_MAP: Record<string, { route: string; label: string }> = {
  wms_pick_exception:      { route: '/problem-center', label: 'Problem Center' },
  wms_pack_exception:      { route: '/problem-center', label: 'Problem Center' },
  wms_stow_pending:        { route: '/wms',            label: 'Warehouse' },
  wms_stow_exception:      { route: '/problem-center', label: 'Problem Center' },
  wms_batch_ready_to_pack: { route: '/wms',            label: 'Warehouse' },
  wms_batch_ready_to_ship: { route: '/wms',            label: 'Warehouse' },
  wms_batch_released:      { route: '/wms',            label: 'Warehouse' },
  wms_receive_arrived:     { route: '/wms',            label: 'Warehouse' },
  wms_receive_exception:   { route: '/problem-center', label: 'Problem Center' },
  // FIX (2026-06-30): was routing to /demand — Sourcing module didn't
  // exist when this was written. Real path confirmed in
  // purchasingSubTabs.ts. bellDeepLink() already appends ?variantId=
  // for this alert type; Sourcing's v1 build (sourcing-recommendation-
  // playbook.md §6) should read that param to scope directly to the
  // flagged variant once implemented.
  stockout_risk:           { route: '/suppliers-portal/sourcing', label: 'Sourcing' },
  // Currently dead — nothing in the backend creates this alert type yet
  // (confirmed via repo-wide search, 2026-06-30). Routed alongside
  // stockout_risk in anticipation of DF-03 (proactive, velocity-based
  // reorder signal — see MVP Roadmap, still 🔴 OPEN). When built, this
  // is where it should land.
  reorder_warning:         { route: '/suppliers-portal/sourcing', label: 'Sourcing' },
  revenue_at_risk:         { route: '/overview',      label: 'Overview' },
  operational:             { route: '/orders',         label: 'Orders' },
  sla_breach:              { route: '/orders',         label: 'Orders' },
  missing_cogs:            { route: '/products',       label: 'Products' },
};

const SNOOZE_OPTIONS = [
  { label: '1 hour',   getUntil: () => new Date(Date.now() + 60 * 60 * 1000).toISOString() },
  { label: '4 hours',  getUntil: () => new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() },
  {
    label: 'Tomorrow',
    getUntil: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    },
  },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function buildDeepLink(alert: Alert): { route: string; label: string } | null {
  const base = ALERT_ROUTE_MAP[alert.alert_type];
  if (!base) return null;
  // Variant-scoped demand alerts get entity_id injected as query param
  if (
    alert.entity_id && alert.entity_type === 'variant' &&
    (alert.alert_type === 'stockout_risk' || alert.alert_type === 'reorder_warning')
  ) {
    return { route: `${base.route}?variantId=${alert.entity_id}`, label: base.label };
  }
  return base;
}

function relativeAge(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatCurrency(value: number): string {
  if (value >= 1000) return `$${Math.round(value / 1000)}k`;
  return `$${Math.round(value).toLocaleString()}`;
}

function tabFromPath(pathname: string): AlertStatus {
  if (pathname.startsWith('/alerts/snoozed'))  return 'snoozed';
  if (pathname.startsWith('/alerts/resolved')) return 'resolved';
  return 'inbox';
}

// ─── SEVERITY COMPONENTS (D5 — never colour alone) ───────────────────────────

function SeverityRail({ severity, acknowledged }: {
  severity: Alert['severity']; acknowledged: boolean;
}) {
  const theme = useTheme();
  const color = acknowledged ? 'var(--rule-2)'
    : severity === 'critical' ? theme.palette.error.main
    : severity === 'warning'  ? theme.palette.warning.main
    : theme.palette.info.main;

  return (
    <Box sx={{
      width: 3, borderRadius: '2px 0 0 2px', flexShrink: 0,
      alignSelf: 'stretch', bgcolor: color,
      transition: 'background-color 0.2s',
    }} />
  );
}

function SeverityBadge({ severity, acknowledged }: {
  severity: Alert['severity']; acknowledged: boolean;
}) {
  const theme = useTheme();
  const map = {
    critical: { icon: AlertCircle,   label: 'Critical', color: theme.palette.error.main },
    warning:  { icon: AlertTriangle, label: 'Warning',  color: theme.palette.warning.main },
    info:     { icon: Info,          label: 'Info',     color: theme.palette.info.main },
  };
  const { icon: Icon, label, color } = map[severity];
  const c = acknowledged ? 'var(--ink-4)' : color;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
      <Icon size={13} color={c} />
      <Typography sx={{
        fontSize: 10, fontWeight: 500, color: c,
        letterSpacing: '0.06em', textTransform: 'uppercase',
      }}>
        {label}
      </Typography>
    </Box>
  );
}

// ─── ALERTS PULSE STRIP (ALR-04) ──────────────────────────────────────────────

function AlertsPulseStrip({ alerts }: { alerts: Alert[] }) {
  const pal   = useAppTheme();
  const theme = useTheme();

  const criticalCount = alerts.filter(a => a.severity === 'critical').length;
  const totalAtRisk   = alerts.reduce((s, a) => s + Number(a.revenue_impact ?? 0), 0);
  const oldest        = alerts.reduce<Alert | null>((o, a) =>
    !o || new Date(a.created_at) < new Date(o.created_at) ? a : o, null);
  const ackCount = alerts.filter(a => a.acknowledged_at !== null).length;
  const total    = alerts.length;

  function StatCard({ label, value, sub, icon: Icon, valueColor }: {
    label: string; value: string; sub?: string;
    icon: React.ElementType; valueColor?: string;
  }) {
    return (
      <Box sx={{
        bgcolor: pal.surface, border: `0.5px solid ${pal.rule}`,
        borderRadius: '10px', p: '14px 16px',
        flex: 1, display: 'flex', flexDirection: 'column', gap: 0.5,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
          <Icon size={12} color={pal.ink4} />
          <Typography sx={{
            fontSize: 10, fontWeight: 500, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: pal.ink4,
          }}>
            {label}
          </Typography>
        </Box>
        <Typography sx={{
          fontSize: 22, fontWeight: 500, lineHeight: 1.1,
          color: valueColor ?? pal.ink, fontVariantNumeric: 'tabular-nums',
        }}>
          {value}
        </Typography>
        {sub && <Typography sx={{ fontSize: 11, color: pal.ink4 }}>{sub}</Typography>}
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', gap: 1.5, mb: 3 }}>
      <StatCard
        label="Critical" icon={AlertCircle}
        value={String(criticalCount)}
        sub={criticalCount === 0 ? 'None active' : 'need action'}
        valueColor={criticalCount > 0 ? theme.palette.error.main : undefined}
      />
      <StatCard
        label="$ at risk" icon={TrendingDown}
        value={totalAtRisk > 0 ? formatCurrency(totalAtRisk) : '—'}
        sub={totalAtRisk > 0 ? 'blocked revenue' : 'None at risk'}
        valueColor={totalAtRisk > 5000 ? theme.palette.error.main : undefined}
      />
      <StatCard
        label="Oldest open" icon={Clock}
        value={oldest ? relativeAge(oldest.created_at) : '—'}
        sub={oldest ? 'unresolved alert' : 'Inbox clear'}
      />
      <StatCard
        label="Acknowledged" icon={CheckCircle2}
        value={total > 0 ? `${ackCount}/${total}` : '—'}
        sub={total > 0 ? 'of active alerts' : 'No active alerts'}
      />
    </Box>
  );
}

// ─── FILTER BAR (ALR-09) ──────────────────────────────────────────────────────

function AlertsFilterBar({ filters, onChange, alerts }: {
  filters: AlertFilters;
  onChange: (f: AlertFilters) => void;
  alerts: Alert[];
}) {
  const pal = useAppTheme();
  const sources = useMemo(() =>
    Array.from(new Set(alerts.map(a => a.source))).sort(),
  [alerts]);

  function FilterChip<T extends string>({ active, label, onToggle }: {
    value?: T; active: boolean; label: string; onToggle: () => void;
  }) {
    return (
      <Chip
        label={label} size="small" onClick={onToggle}
        sx={{
          fontSize: 12, height: 26, fontWeight: active ? 500 : 400, cursor: 'pointer',
          bgcolor: active ? 'var(--accent-ghost)' : 'transparent',
          border: `0.5px solid ${active ? 'var(--accent-border)' : pal.rule}`,
          color: active ? 'var(--accent)' : pal.ink3,
          '&:hover': { bgcolor: active ? 'var(--accent-ghost)' : pal.bg2 },
        }}
      />
    );
  }

  const hasFilters = filters.category || filters.severity || filters.source;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Filter size={12} color={pal.ink4} />
        <Typography sx={{ fontSize: 11, color: pal.ink4, fontWeight: 500 }}>Filter</Typography>
      </Box>

      {(['critical', 'warning', 'info'] as const).map(s => (
        <FilterChip key={s} value={s} active={filters.severity === s}
          label={s.charAt(0).toUpperCase() + s.slice(1)}
          onToggle={() => onChange({ ...filters, severity: filters.severity === s ? undefined : s })}
        />
      ))}

      {(Object.keys(CATEGORY_CONFIG) as (AlertCategory | 'uncategorized')[])
        .filter(c => c !== 'uncategorized')
        .map(c => (
          <FilterChip key={c} value={c} active={filters.category === c}
            label={CATEGORY_CONFIG[c].label}
            onToggle={() => onChange({ ...filters, category: filters.category === c ? undefined : c as AlertCategory })}
          />
        ))}

      {sources.map(s => (
        <FilterChip key={s} value={s} active={filters.source === s}
          label={s}
          onToggle={() => onChange({ ...filters, source: filters.source === s ? undefined : s })}
        />
      ))}

      {hasFilters && (
        <Chip
          size="small" label="Clear"
          onClick={() => onChange({ status: filters.status })}
          sx={{
            fontSize: 12, height: 26, cursor: 'pointer',
            bgcolor: 'transparent', color: pal.ink3,
            border: `0.5px solid ${pal.rule}`,
            '& .MuiChip-icon': { marginLeft: '6px' },
          }}
          icon={<X size={10} color={pal.ink4} />}
        />
      )}
    </Box>
  );
}

// ─── ALERT CARD (ALR-06) ──────────────────────────────────────────────────────

/**
 * AlertCard
 *
 * Severity: rail (D5 visual strip) + SeverityBadge (icon + text label).
 * Actions:  Acknowledge (all) · Snooze (all) · Resolve (owner/admin only).
 * Deep link: entity-aware primary CTA (KI-1 fix).
 * Acknowledged footer: who + when.
 */
function AlertCard({ alert, isOwner, currentUserId, readOnly = false }: {
  alert: Alert; isOwner: boolean; currentUserId: number | null; readOnly?: boolean;
}) {
  const pal   = useAppTheme();
  const theme = useTheme();
  const nav   = useNavigate();

  const { mutate: acknowledge, isPending: ackPending }    = useAcknowledgeAlert();
  const { mutate: snooze,      isPending: snoozePending } = useSnoozeAlert();
  const { mutate: resolve,     isPending: resolvePending }= useResolveAlert();

  const [snoozeAnchor, setSnoozeAnchor] = useState<null | HTMLElement>(null);

  const acknowledged = alert.acknowledged_at !== null;
  const deepLink     = buildDeepLink(alert);
  const revenue      = alert.revenue_impact ? Number(alert.revenue_impact) : null;
  const ackByLabel   = acknowledged
    ? (alert.acknowledged_by === currentUserId ? 'by you' : 'by a teammate')
    : null;

  return (
    <Box sx={{
      display: 'flex',
      border: `0.5px solid ${pal.rule}`,
      borderRadius: '10px',
      overflow: 'hidden',
      bgcolor: acknowledged ? pal.bg2 : pal.surface,
      opacity: acknowledged ? 0.85 : 1,
      transition: 'opacity 0.2s, background-color 0.2s',
    }}>
      {/* SEVERITY RAIL — paired with badge below, never colour alone (D5) */}
      <SeverityRail severity={alert.severity} acknowledged={acknowledged} />

      <Box sx={{ flex: 1, p: '12px 14px', minWidth: 0 }}>
        {/* TOP META ROW */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75, flexWrap: 'wrap' }}>
          <SeverityBadge severity={alert.severity} acknowledged={acknowledged} />
          <Chip label={alert.source} size="small" sx={{
            fontSize: 10, height: 18, fontWeight: 400,
            bgcolor: 'var(--bg-3)', color: pal.ink3,
            border: `0.5px solid ${pal.rule}`,
          }} />
          <Typography sx={{ fontSize: 11, color: pal.ink4, ml: 'auto', flexShrink: 0 }}>
            {relativeAge(alert.created_at)}
          </Typography>
        </Box>

        {/* TITLE + REVENUE */}
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
          <Typography sx={{
            fontSize: 13, fontWeight: 500, lineHeight: 1.3,
            color: acknowledged ? pal.ink3 : pal.ink,
          }}>
            {alert.title}
          </Typography>
          {revenue !== null && revenue > 0 && (
            <Typography sx={{
              fontSize: 11, fontWeight: 500, flexShrink: 0,
              fontVariantNumeric: 'tabular-nums',
              color: alert.severity === 'critical' ? theme.palette.error.main : pal.ink3,
            }}>
              {formatCurrency(revenue)}
            </Typography>
          )}
        </Box>

        {/* MESSAGE */}
        <Typography sx={{ fontSize: 12, color: pal.ink3, lineHeight: 1.5, mb: 1 }}>
          {alert.message}
        </Typography>

        {/* ACTION ROW — hidden on resolved tab (read-only history) */}
        {!readOnly && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          {/* PRIMARY CTA — deep link */}
          {deepLink && (
            <Box
              onClick={() => nav(deepLink.route)}
              sx={{
                display: 'inline-flex', alignItems: 'center', gap: 0.5,
                px: 1.25, py: 0.5, fontSize: 12, fontWeight: 500,
                bgcolor: 'var(--accent)', color: '#fff',
                borderRadius: '6px', cursor: 'pointer', flexShrink: 0,
                '&:hover': { bgcolor: 'var(--accent-hover)' },
              }}
            >
              Go to {deepLink.label} <ArrowRight size={11} />
            </Box>
          )}

          {/* ACKNOWLEDGE — hidden once acknowledged */}
          {!acknowledged && (
            <Box
              onClick={() => !ackPending && acknowledge(alert.id)}
              sx={{
                display: 'inline-flex', alignItems: 'center', gap: 0.5,
                px: 1.25, py: 0.5, fontSize: 12, fontWeight: 400,
                border: `0.5px solid ${pal.rule}`, borderRadius: '6px',
                color: pal.ink3, bgcolor: 'transparent',
                cursor: ackPending ? 'wait' : 'pointer',
                '&:hover': { bgcolor: pal.bg2 },
              }}
            >
              <CheckCircle2 size={11} /> Acknowledge
            </Box>
          )}

          {/* SNOOZE */}
          <Box
            onClick={(e) => setSnoozeAnchor(e.currentTarget)}
            sx={{
              display: 'inline-flex', alignItems: 'center', gap: 0.5,
              px: 1.25, py: 0.5, fontSize: 12, fontWeight: 400,
              border: `0.5px solid ${pal.rule}`, borderRadius: '6px',
              color: pal.ink3, bgcolor: 'transparent',
              cursor: snoozePending ? 'wait' : 'pointer',
              '&:hover': { bgcolor: pal.bg2 },
            }}
          >
            <Clock size={11} /> Snooze
          </Box>
          <Menu
            anchorEl={snoozeAnchor}
            open={Boolean(snoozeAnchor)}
            onClose={() => setSnoozeAnchor(null)}
            PaperProps={{
              sx: {
                bgcolor: pal.surface,
                border: `0.5px solid ${pal.rule}`,
                boxShadow: pal.shadowMd,
              },
            }}
          >
            {SNOOZE_OPTIONS.map(opt => (
              <MenuItem
                key={opt.label}
                sx={{ fontSize: 13, color: pal.ink }}
                onClick={() => {
                  snooze({ alertId: alert.id, until: opt.getUntil() });
                  setSnoozeAnchor(null);
                }}
              >
                {opt.label}
              </MenuItem>
            ))}
          </Menu>

          {/* RESOLVE — owner/admin only; backend enforces 403 for operators */}
          {isOwner && (
            <Box
              onClick={() => !resolvePending && resolve(alert.id)}
              sx={{
                display: 'inline-flex', alignItems: 'center', gap: 0.5,
                px: 1.25, py: 0.5, fontSize: 12, fontWeight: 400,
                border: `0.5px solid ${pal.rule}`, borderRadius: '6px',
                color: pal.ink4, bgcolor: 'transparent', ml: 'auto',
                cursor: resolvePending ? 'wait' : 'pointer',
                '&:hover': { bgcolor: pal.bg2 },
              }}
            >
              <RotateCcw size={11} /> Resolve
            </Box>
          )}
        </Box>
        }

        {/* ACKNOWLEDGED FOOTER */}
        {acknowledged && ackByLabel && (
          <Box sx={{
            mt: 1, pt: 1,
            borderTop: `0.5px solid ${pal.rule}`,
            display: 'flex', alignItems: 'center', gap: 0.5,
          }}>
            <CheckCircle2 size={11} color={pal.ink4} />
            <Typography sx={{ fontSize: 11, color: pal.ink4 }}>
              Acknowledged {ackByLabel} · {relativeAge(alert.acknowledged_at!)}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}

// ─── GROUPING COMPONENTS (ALR-05) ─────────────────────────────────────────────

function AlertCategoryGroup({ category, alerts, isOwner, currentUserId, readOnly = false }: {
  category: AlertCategory | 'uncategorized';
  alerts: Alert[]; isOwner: boolean; currentUserId: number | null; readOnly?: boolean;
}) {
  const pal = useAppTheme();
  const [open, setOpen] = useState(true);
  const { icon: Icon, label } = CATEGORY_CONFIG[category];

  return (
    <Box sx={{ mb: 2 }}>
      <Box
        onClick={() => setOpen(v => !v)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1,
          px: 1, py: 0.75, cursor: 'pointer', borderRadius: '6px', mb: 1,
          '&:hover': { bgcolor: pal.bg2 }, userSelect: 'none',
        }}
      >
        <Icon size={14} color={pal.ink3} />
        <Typography sx={{ fontSize: 12, fontWeight: 500, color: pal.ink2, flex: 1 }}>
          {label}
        </Typography>
        <Chip label={alerts.length} size="small" sx={{
          height: 18, fontSize: 11, bgcolor: 'var(--bg-3)', color: pal.ink3,
        }} />
        {open
          ? <ChevronDown  size={13} color={pal.ink4} />
          : <ChevronRight size={13} color={pal.ink4} />}
      </Box>
      <Collapse in={open}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {alerts.map(alert => (
            <AlertCard key={alert.id} alert={alert} isOwner={isOwner} currentUserId={currentUserId} readOnly={readOnly} />
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}

function AlertSeverityGroup({ severity, alerts, isOwner, currentUserId, readOnly = false }: {
  severity: Alert['severity'];
  alerts: Alert[]; isOwner: boolean; currentUserId: number | null; readOnly?: boolean;
}) {
  const pal   = useAppTheme();
  const theme = useTheme();
  const [open, setOpen] = useState(true);

  const color = severity === 'critical' ? theme.palette.error.main
    : severity === 'warning' ? theme.palette.warning.main : theme.palette.info.main;
  const Icon  = severity === 'critical' ? AlertCircle
    : severity === 'warning' ? AlertTriangle : Info;

  return (
    <Box sx={{ mb: 2 }}>
      <Box
        onClick={() => setOpen(v => !v)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1,
          px: 1, py: 0.75, cursor: 'pointer', borderRadius: '6px', mb: 1,
          '&:hover': { bgcolor: pal.bg2 }, userSelect: 'none',
        }}
      >
        <Icon size={14} color={color} />
        <Typography sx={{ fontSize: 12, fontWeight: 500, color: pal.ink2, flex: 1 }}>
          {severity.charAt(0).toUpperCase() + severity.slice(1)}
        </Typography>
        <Chip label={alerts.length} size="small" sx={{
          height: 18, fontSize: 11, bgcolor: 'var(--bg-3)', color: pal.ink3,
        }} />
        {open
          ? <ChevronDown  size={13} color={pal.ink4} />
          : <ChevronRight size={13} color={pal.ink4} />}
      </Box>
      <Collapse in={open}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {alerts.map(alert => (
            <AlertCard key={alert.id} alert={alert} isOwner={isOwner} currentUserId={currentUserId} readOnly={readOnly} />
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}

// ─── SKELETON (ALR-10) ────────────────────────────────────────────────────────

function AlertsSkeleton() {
  const pal = useAppTheme();
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {[80, 60, 90].map((w, i) => (
        <Box key={i} sx={{
          display: 'flex', border: `0.5px solid ${pal.rule}`,
          borderRadius: '10px', overflow: 'hidden', bgcolor: pal.surface,
        }}>
          <Box sx={{ width: 3, bgcolor: pal.rule, flexShrink: 0 }} />
          <Box sx={{ flex: 1, p: '12px 14px', display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Skeleton variant="text" width={80}   height={14} sx={{ bgcolor: 'var(--bg-3)' }} />
            <Skeleton variant="text" width={`${w}%`} height={16} sx={{ bgcolor: 'var(--bg-3)' }} />
            <Skeleton variant="text" width="55%"  height={13} sx={{ bgcolor: 'var(--bg-3)' }} />
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Skeleton variant="rounded" width={100} height={28} sx={{ bgcolor: 'var(--bg-3)' }} />
              <Skeleton variant="rounded" width={90}  height={28} sx={{ bgcolor: 'var(--bg-3)' }} />
            </Box>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

// ─── EMPTY STATES (ALR-10) ────────────────────────────────────────────────────

const EMPTY_COPY: Record<AlertStatus, { headline: string; sub: string }> = {
  inbox:    {
    headline: 'All clear — your operations are running smoothly.',
    sub: 'Alerts will appear here when action is needed.',
  },
  snoozed:  {
    headline: 'Nothing snoozed.',
    sub: 'Alerts you park will wait here until their timer expires.',
  },
  resolved: {
    headline: 'No resolved alerts yet.',
    sub: 'Auto-resolved and manually resolved alerts will appear here.',
  },
};

function EmptyState({ status }: { status: AlertStatus }) {
  const pal  = useAppTheme();
  const copy = EMPTY_COPY[status];
  return (
    <Box sx={{
      p: 4, textAlign: 'center',
      border: `0.5px solid ${pal.rule}`,
      borderRadius: '10px', bgcolor: pal.surface,
    }}>
      <Typography sx={{ fontSize: 14, fontWeight: 500, color: pal.ink, mb: 0.5 }}>
        {copy.headline}
      </Typography>
      <Typography sx={{ fontSize: 13, color: pal.ink3 }}>{copy.sub}</Typography>
    </Box>
  );
}

// ─── PAGE SHELL (ALR-02, ALR-03) ──────────────────────────────────────────────

/**
 * AlertsPage
 *
 * Tab routing:
 *   /alerts          → inbox (live, polled 30s)
 *   /alerts/snoozed  → snoozed
 *   /alerts/resolved → resolved history
 *   /alerts/rules    → rule builder (growth-gated via ModuleTabBar)
 */
export default function AlertsPage() {
  const pal        = useAppTheme();
  const { user }   = useAuth();
  const { pathname } = useLocation();

  const isOwner       = user?.role === 'owner' || user?.role === 'admin';
  const currentUserId = (user as { userId?: number })?.userId ?? null;

  const [viewMode,    setViewMode]    = useState<'consequence' | 'severity'>('consequence');
  const [chipFilters, setChipFilters] = useState<Omit<AlertFilters, 'status'>>({});

  const activeTab   = tabFromPath(pathname);
  const isRulesTab  = pathname.startsWith('/alerts/rules');
  const isReadOnly  = activeTab === 'resolved';

  const filters: AlertFilters = { status: activeTab, ...chipFilters };

  const { data, isLoading, isError } = useAlerts(filters);
  const alerts = useMemo(() => data?.data ?? [], [data]);

  // PulseStrip always reflects live inbox regardless of active tab
  const { data: inboxData } = useAlerts({ status: 'inbox' });
  const inboxAlerts = useMemo(() => inboxData?.data ?? [], [inboxData]);

  // Client-side filter pass (until backend supports category/severity params)
  const filtered = useMemo(() => {
    let list = alerts;
    if (chipFilters.category) list = list.filter(a => (a.category ?? 'uncategorized') === chipFilters.category);
    if (chipFilters.severity) list = list.filter(a => a.severity === chipFilters.severity);
    if (chipFilters.source)   list = list.filter(a => a.source   === chipFilters.source);
    return list;
  }, [alerts, chipFilters]);

  // Consequence grouping — sorted by severity rank then revenue_impact within each group
  const byCategory = useMemo(() => {
    const map = new Map<AlertCategory | 'uncategorized', Alert[]>();
    const sevOrder = { critical: 0, warning: 1, info: 2 };
    filtered.forEach(a => {
      const key = (a.category ?? 'uncategorized') as AlertCategory | 'uncategorized';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    });
    map.forEach(list => list.sort((x, y) => {
      const sd = sevOrder[x.severity] - sevOrder[y.severity];
      return sd !== 0 ? sd : Number(y.revenue_impact ?? 0) - Number(x.revenue_impact ?? 0);
    }));
    return map;
  }, [filtered]);

  const bySeverity = useMemo(() => ({
    critical: filtered.filter(a => a.severity === 'critical'),
    warning:  filtered.filter(a => a.severity === 'warning'),
    info:     filtered.filter(a => a.severity === 'info'),
  }), [filtered]);

  const headerSubline = activeTab === 'inbox'
    ? 'Ranked by commercial impact — act on what matters most.'
    : activeTab === 'snoozed'
    ? 'Parked alerts — returning when their timer expires.'
    : activeTab === 'resolved'
    ? 'Auto-resolved and manually resolved alert history.'
    : 'Configure alert rules for your operations.';

  return (
    <Box sx={{ bgcolor: pal.bg, minHeight: '100%', p: 3 }}>
      {/* PAGE HEADER */}
      <Box sx={{ mb: 2 }}>
        <Typography sx={{
          fontSize: 22, fontWeight: 500, color: pal.ink,
          fontFamily: 'var(--serif)',
        }}>
          Alerts
        </Typography>
        <Typography sx={{ fontSize: 13, color: pal.ink3, mt: 0.5 }}>
          {headerSubline}
        </Typography>
      </Box>

      {/* MODULE TAB BAR (ALR-03) */}
      <ModuleTabBar tabs={ALERTS_TABS} />

      {/* RULES TAB — AlertRulesPanel (moved from sidebar, ALR-11) */}
      {isRulesTab ? (
        <Box sx={{ mt: 3 }}>
          <AlertRulesPanel />
        </Box>
      ) : (
        <>
          {/* PULSE STRIP — inbox stats always (ALR-04) */}
          {activeTab === 'inbox' && !isLoading && (
            <AlertsPulseStrip alerts={inboxAlerts} />
          )}

          {/* FILTER BAR + VIEW TOGGLE */}
          {!isLoading && alerts.length > 0 && (
            <Box sx={{
              display: 'flex', alignItems: 'flex-start', gap: 2,
              justifyContent: 'space-between', mb: 1,
            }}>
              <AlertsFilterBar
                filters={filters}
                alerts={alerts}
                onChange={(f) => setChipFilters({
                  category: f.category, severity: f.severity, source: f.source,
                })}
              />

              {/* VIEW TOGGLE — consequence (D1 default) ⇄ severity */}
              {activeTab === 'inbox' && (
                <Box sx={{
                  display: 'flex', flexShrink: 0,
                  border: `0.5px solid ${pal.rule}`,
                  borderRadius: '8px', overflow: 'hidden',
                }}>
                  {(['consequence', 'severity'] as const).map(mode => (
                    <Box
                      key={mode}
                      onClick={() => setViewMode(mode)}
                      sx={{
                        px: 1.5, py: 0.75, fontSize: 12, cursor: 'pointer',
                        fontWeight: mode === viewMode ? 500 : 400,
                        display: 'flex', alignItems: 'center', gap: 0.5,
                        bgcolor: mode === viewMode ? 'var(--accent-ghost)' : 'transparent',
                        color:   mode === viewMode ? 'var(--accent)' : pal.ink3,
                        '&:hover': { bgcolor: mode === viewMode ? 'var(--accent-ghost)' : pal.bg2 },
                      }}
                    >
                      {mode === 'consequence'
                        ? <LayoutGrid  size={12} />
                        : <ListFilter  size={12} />}
                      {mode.charAt(0).toUpperCase() + mode.slice(1)}
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          )}

          {/* LOADING */}
          {isLoading && <AlertsSkeleton />}

          {/* ERROR */}
          {isError && (
            <Box sx={{
              p: 3, textAlign: 'center',
              border: `0.5px solid ${pal.rule}`,
              borderRadius: '10px', bgcolor: pal.surface,
            }}>
              <Typography sx={{ fontSize: 13, color: pal.ink3 }}>
                Failed to load alerts. Check your connection and refresh.
              </Typography>
            </Box>
          )}

          {/* EMPTY */}
          {!isLoading && !isError && filtered.length === 0 && (
            <EmptyState status={activeTab} />
          )}

          {/* CONSEQUENCE VIEW — default (D1) */}
          {!isLoading && !isError && filtered.length > 0 &&
            (activeTab !== 'inbox' || viewMode === 'consequence') && (
            <>
              {CATEGORY_ORDER.map(cat => {
                const group = byCategory.get(cat);
                if (!group?.length) return null;
                return (
                  <AlertCategoryGroup
                    key={cat} category={cat}
                    alerts={group} isOwner={isOwner} currentUserId={currentUserId}
                    readOnly={isReadOnly}
                  />
                );
              })}
            </>
          )}

          {/* SEVERITY VIEW — toggle (inbox only) */}
          {!isLoading && !isError && filtered.length > 0 &&
            activeTab === 'inbox' && viewMode === 'severity' && (
            <>
              {(['critical', 'warning', 'info'] as const).map(sev => {
                const group = bySeverity[sev];
                if (!group.length) return null;
                return (
                  <AlertSeverityGroup
                    key={sev} severity={sev}
                    alerts={group} isOwner={isOwner} currentUserId={currentUserId}
                    readOnly={isReadOnly}
                  />
                );
              })}
            </>
          )}
        </>
      )}
    </Box>
  );
}