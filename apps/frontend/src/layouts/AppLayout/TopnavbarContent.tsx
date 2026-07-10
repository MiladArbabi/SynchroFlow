/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/layouts/AppLayout/TopnavbarContent.tsx
import React, { useState } from "react";
import { useLocation, Link as RouterLink } from "react-router-dom";
import { getBreadcrumbLabel } from "runtime/registerNav";
import {
  Box, IconButton, Typography, Breadcrumbs as MuiBreadcrumbs,
  Link, Tooltip, Badge, Popover,
} from "@mui/material";
import { useColorScheme } from "@mui/material/styles";
import { useTheme } from "@mui/material/styles";
import IconComponent from "../../components/Icon";
import { TrialCountdownChip } from 'components/TrialCountdownChip';
import { Bell, Home, AlertCircle, AlertTriangle, Info, ArrowRight, CheckCircle2 } from 'lucide-react';
import { ActivationChecklistButton } from '../../components/ActivationChecklist';
import { useNavigate } from 'react-router-dom';
import { useAlerts, useAcknowledgeAlert, type Alert } from '../../pages/alerts/useAlerts';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useCurrency } from '../../hooks/useCurrency';
import { useShopLifecycle } from 'lifecycle/ShopLifecycleContext';
import { useIntegration } from '../../contexts/integration/useIntegration';
import { axiosInstance } from "api/axiosConfig";

/**
 * TOPNAV BELL — ALERTS DROPDOWN SHEET
 * -------------------------------------
 * Blueprint D6: counts on bell; sidenav stays a calm dot.
 * Blueprint §1: bell = quick-glance surface; /alerts = full working surface.
 *
 * Behaviour:
 * - Click bell → opens right-anchored Popover (~380px, max 70vh)
 * - Shows top 6 inbox alerts ranked by backend (severity → revenue)
 * - Each row: severity icon+label, title, revenue, deep-link CTA, acknowledge
 * - "See all alerts →" footer → navigates to /alerts and closes sheet
 * - Cmd/middle-click on bell still navigates directly to /alerts
 */

// ─── ROUTE MAP (mirrors AlertsPage ALERT_ROUTE_MAP) ───────────────────────────
const BELL_ROUTE_MAP: Record<string, { route: string; label: string }> = {
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

function bellDeepLink(alert: Alert): { route: string; label: string } | null {
  const base = BELL_ROUTE_MAP[alert.alert_type];
  if (!base) return null;
  if (alert.entity_id && alert.entity_type === 'variant' &&
    (alert.alert_type === 'stockout_risk' || alert.alert_type === 'reorder_warning')) {
    return { route: `${base.route}?variantId=${alert.entity_id}`, label: base.label };
  }
  return base;
}

function relativeAge(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2)  return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// ─── MINI ALERT ROW ───────────────────────────────────────────────────────────

function BellAlertRow({ alert, onClose }: { alert: Alert; onClose: () => void }) {
  const pal   = useAppTheme();
  const theme = useTheme();
  const nav   = useNavigate();
  const { mutate: acknowledge, isPending } = useAcknowledgeAlert();

  const deepLink = bellDeepLink(alert);
  const revenue  = alert.revenue_impact ? Number(alert.revenue_impact) : null;
  const { format } = useCurrency();
  const acked    = alert.acknowledged_at !== null;

  const sevColor = acked ? pal.ink4
    : alert.severity === 'critical' ? theme.palette.error.main
    : alert.severity === 'warning'  ? theme.palette.warning.main
    : theme.palette.info.main;

  const SevIcon = alert.severity === 'critical' ? AlertCircle
    : alert.severity === 'warning' ? AlertTriangle : Info;

  return (
    <Box sx={{
      display: 'flex', gap: 1, px: 1.5, py: 1.25,
      borderBottom: `0.5px solid ${pal.rule}`,
      bgcolor: acked ? pal.bg2 : pal.surface,
      opacity: acked ? 0.75 : 1,
      '&:last-of-type': { borderBottom: 'none' },
    }}>
      {/* SEVERITY RAIL */}
      <Box sx={{
        width: 2.5, borderRadius: 1, flexShrink: 0, alignSelf: 'stretch',
        bgcolor: sevColor, mt: 0.25,
      }} />

      <Box sx={{ flex: 1, minWidth: 0 }}>
        {/* META */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.4 }}>
          <SevIcon size={11} color={sevColor} />
          <Typography sx={{
            fontSize: 10, fontWeight: 500, textTransform: 'uppercase',
            letterSpacing: '0.06em', color: sevColor,
          }}>
            {alert.severity}
          </Typography>
          <Typography sx={{ fontSize: 10, color: pal.ink4, ml: 'auto', flexShrink: 0 }}>
            {relativeAge(alert.created_at)}
          </Typography>
        </Box>

        {/* TITLE + REVENUE */}
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, mb: 0.6 }}>
          <Typography sx={{
            fontSize: 12, fontWeight: 500, color: acked ? pal.ink3 : pal.ink,
            lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {alert.title}
          </Typography>
          {revenue !== null && revenue > 0 && (
            <Typography sx={{
              fontSize: 11, fontWeight: 500, flexShrink: 0,
              color: alert.severity === 'critical' ? theme.palette.error.main : pal.ink3,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {format(revenue)}
            </Typography>
          )}
        </Box>

        {/* ACTIONS */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          {deepLink && (
            <Box
              onClick={() => { nav(deepLink.route); onClose(); }}
              sx={{
                display: 'inline-flex', alignItems: 'center', gap: 0.4,
                px: 1, py: 0.375, fontSize: 11, fontWeight: 500,
                bgcolor: 'var(--accent)', color: '#fff', borderRadius: '5px',
                cursor: 'pointer', flexShrink: 0,
                '&:hover': { bgcolor: 'var(--accent-hover)' },
              }}
            >
              Go to {deepLink.label} <ArrowRight size={10} />
            </Box>
          )}
          {!acked && (
            <Box
              onClick={() => !isPending && acknowledge(alert.id)}
              sx={{
                display: 'inline-flex', alignItems: 'center', gap: 0.4,
                px: 1, py: 0.375, fontSize: 11,
                border: `0.5px solid ${pal.rule}`, borderRadius: '5px',
                color: pal.ink3, bgcolor: 'transparent',
                cursor: isPending ? 'wait' : 'pointer',
                '&:hover': { bgcolor: pal.bg2 },
              }}
            >
              <CheckCircle2 size={10} /> Ack
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

// ─── TOPNAV COMPONENT ─────────────────────────────────────────────────────────

interface TopnavbarContentProps {
  isEditing: boolean;
  onEditToggle: () => void;
  onAddWidget: () => void;
  onToggleSidenav: () => void;
}

const TopnavbarContent: React.FC<TopnavbarContentProps> = ({ onToggleSidenav }) => {
  const location  = useLocation();
  const pal       = useAppTheme();
  const { mode, setMode } = useColorScheme();
  const { phase } = useShopLifecycle();
  const isFt2     = phase === 'FT2_READY';

  const navigate  = useNavigate();
  const { data: alertsData } = useAlerts({ status: 'inbox' });
  const allInbox     = alertsData?.data ?? [];
  const unreadAlerts = allInbox.length;
  // Top 6 for the sheet — already ranked by backend (severity → revenue)
  const sheetAlerts  = allInbox.slice(0, 6);

  const { isSyncComplete, integrationId, refresh } = useIntegration();
  const isLive = isSyncComplete;
  const [resyncing, setResyncing] = useState(false);
  const [syncAnchor, setSyncAnchor] = useState<null | HTMLElement>(null);
  const [syncDetail, setSyncDetail] = useState<null | {
    lastSyncedAt: string | null;
    counts: { orders: number; variants: number; products: number };
    recentProducts: { title: string; status: string; updated_at: string }[];
  }>(null);

  const handlePillClick = (e: React.MouseEvent<HTMLElement>) => {
    setSyncAnchor(e.currentTarget);
    // Refetch silently — preserve previous data while loading
    axiosInstance
      .get('/api/v1/integrations/sync-status')
      .then((res) => setSyncDetail({
        lastSyncedAt: res.data.lastSyncedAt ?? null,
        counts: res.data.counts,
        recentProducts: res.data.recentProducts ?? [],
      }))
      .catch((err) => console.error('[SYNC_DETAIL_FETCH_FAILED]', err));
  };

  const handleResync = () => {
    if (!integrationId || resyncing) return;
    setResyncing(true);
    axiosInstance
      .post(`/api/v1/integrations/sync/${integrationId}`)
      .then(() => {
        refresh();
        return axiosInstance.get('/api/v1/integrations/sync-status');
      })
      .then((res) => setSyncDetail({
        lastSyncedAt: res.data.lastSyncedAt ?? null,
        counts: res.data.counts,
        recentProducts: res.data.recentProducts ?? [],
      }))
      .catch((err) => console.error('[RESYNC_FAILED]', err))
      .finally(() => setResyncing(false));
  };

  const formatTimeAgo = (iso: string) => {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const [bellAnchor, setBellAnchor] = useState<null | HTMLElement>(null);
  const sheetOpen = Boolean(bellAnchor);
  // ISS-095/DEC-04: breadcrumb resolves against the registered nav tree
  // (title + optional parentId), not by splitting/capitalizing the URL.
  // Falls back to the raw path segment if a route isn't registered in nav.
  const crumb = getBreadcrumbLabel(location.pathname);
  const fallbackLabel = location.pathname.split("/").filter(Boolean).pop() ?? "";
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  return (
    <Box sx={{
      width: "100%", display: "flex", alignItems: "center",
      justifyContent: "space-between", padding: "0 16px",
    }}>
      {/* LEFT — LOGO + BREADCRUMBS */}
      <Box sx={{ display: "flex", alignItems: "center", minWidth: 0, flex: "1 1 auto", overflow: "hidden" }}>
        <Box
          component="img"
          src={mode === 'dark' ? '/logo-dark.png' : '/logo.png'}
          alt="LaSyncro"
          sx={{ height: 22, width: 'auto', display: 'block', mr: 2, ml: 1, flexShrink: 0 }}
        />
        <MuiBreadcrumbs
          aria-label="breadcrumb"
          sx={{ minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}
        >
          <Link component={RouterLink} to="/" underline="none" sx={{
            display: 'flex', alignItems: 'center',
            color: 'var(--ink-3)', '&:hover': { color: 'var(--ink)' },
          }}>
            <Home size={14} strokeWidth={1.75} />
          </Link>
          {crumb?.parentLabel && (
            <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>
              {crumb.parentLabel}
            </Typography>
          )}
          <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--accent)' }}>
            {crumb?.label ?? capitalize(fallbackLabel.replace(/-/g, " "))}
          </Typography>
        </MuiBreadcrumbs>
      </Box>

      <Box sx={{ flex: "0 0 16px" }} />

      {/* RIGHT — BELL + CONTROLS */}
      <Box display="flex" alignItems="center" gap={1} sx={{ flexShrink: 0, whiteSpace: "nowrap", ml: "auto" }}>
        {isFt2 && (
          <>
            {/* CHECKLIST — activation progress, left of bell */}
            <ActivationChecklistButton />

            {/* BELL — opens dropdown sheet */}
            <Tooltip title={sheetOpen ? '' : 'Alerts'}>
              <IconButton
                size="small"
                onClick={(e) => setBellAnchor(e.currentTarget)}
                sx={{ color: unreadAlerts > 0 ? 'var(--accent)' : 'text.secondary' }}
                aria-label={`Alerts — ${unreadAlerts} active`}
              >
                <Badge
                  badgeContent={unreadAlerts > 0 ? unreadAlerts : undefined}
                  max={99}
                  color="error"
                  sx={{ '& .MuiBadge-badge': { fontSize: 9, minWidth: 16, height: 16 } }}
                >
                  <Bell size={18} strokeWidth={unreadAlerts > 0 ? 2.5 : 1.75} />
                </Badge>
              </IconButton>
            </Tooltip>

            {/* ALERTS DROPDOWN SHEET */}
            <Popover
              open={sheetOpen}
              anchorEl={bellAnchor}
              onClose={() => setBellAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              PaperProps={{
                sx: {
                  width: 380, maxHeight: '70vh',
                  bgcolor: pal.surface,
                  border: `0.5px solid ${pal.rule}`,
                  boxShadow: pal.shadowMd,
                  borderRadius: '10px',
                  display: 'flex', flexDirection: 'column',
                  overflow: 'hidden', mt: 0.75,
                },
              }}
            >
              {/* SHEET HEADER */}
              <Box sx={{
                px: 1.5, py: 1.25,
                borderBottom: `0.5px solid ${pal.rule}`,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                flexShrink: 0,
              }}>
                <Typography sx={{ fontSize: 13, fontWeight: 500, color: pal.ink }}>
                  Alerts
                </Typography>
                {unreadAlerts > 0 && (
                  <Typography sx={{ fontSize: 11, color: pal.ink4 }}>
                    {unreadAlerts} active
                  </Typography>
                )}
              </Box>

              {/* ALERT ROWS */}
              <Box sx={{ overflowY: 'auto', flex: 1 }}>
                {sheetAlerts.length === 0 ? (
                  <Box sx={{ px: 2, py: 3, textAlign: 'center' }}>
                    <Typography sx={{ fontSize: 13, color: pal.ink3 }}>
                      All clear — no active alerts.
                    </Typography>
                  </Box>
                ) : (
                  sheetAlerts.map(alert => (
                    <BellAlertRow
                      key={alert.id}
                      alert={alert}
                      onClose={() => setBellAnchor(null)}
                    />
                  ))
                )}
              </Box>

              {/* SHEET FOOTER — "See all" CTA */}
              <Box
                onClick={() => { navigate('/alerts'); setBellAnchor(null); }}
                sx={{
                  px: 1.5, py: 1.25,
                  borderTop: `0.5px solid ${pal.rule}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5,
                  cursor: 'pointer', flexShrink: 0,
                  color: 'var(--accent)',
                  '&:hover': { bgcolor: 'var(--accent-ghost)' },
                }}
              >
                <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--accent)' }}>
                  See all alerts
                </Typography>
                <ArrowRight size={12} color="var(--accent)" />
              </Box>
            </Popover>

            <TrialCountdownChip />

            <Tooltip title="Light mode">
              <IconButton
                size="small"
                onClick={() => setMode("light")}
                sx={{ color: mode === "light" ? "primary.main" : "text.secondary" }}
              >
                <IconComponent name="Sun" size="medium" />
              </IconButton>
            </Tooltip>

            <Tooltip title="Dark mode">
              <IconButton
                size="small"
                onClick={() => setMode("dark")}
                sx={{ color: mode === "dark" ? "primary.main" : "text.secondary" }}
              >
                <IconComponent name="Moon" size="medium" />
              </IconButton>
            </Tooltip>
          </>
        )}

        {/* SYNC STATUS PILL */}
        {isFt2 && (
          <>
            <Box
              onClick={handlePillClick}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.6,
                px: 1.25, py: 0.375, borderRadius: '20px', flexShrink: 0,
                bgcolor: isLive ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)',
                border: `0.5px solid ${isLive ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}`,
                cursor: 'pointer',
                opacity: resyncing ? 0.6 : 1,
                transition: 'opacity 0.2s',
              }}>
              <Box sx={{
                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                bgcolor: isLive ? '#22C55E' : '#F59E0B',
                boxShadow: isLive ? '0 0 4px rgba(34,197,94,0.6)' : '0 0 4px rgba(245,158,11,0.6)',
              }} />
              <Typography sx={{
                fontSize: 11, fontWeight: 500, lineHeight: 1, whiteSpace: 'nowrap',
                color: isLive ? '#22C55E' : '#F59E0B',
              }}>
                {resyncing ? 'Syncing…' : isLive ? 'Live' : 'Syncing'}
              </Typography>
            </Box>

            {/* SYNC STATUS POPOVER */}
            <Popover
              open={Boolean(syncAnchor)}
              anchorEl={syncAnchor}
              onClose={() => setSyncAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              slotProps={{ paper: {
                sx: { mt: 1, width: 300, borderRadius: '10px', p: 2,
                  bgcolor: 'background.paper', boxShadow: '0 4px 24px rgba(0,0,0,0.18)' }
              }}}
            >
              {/* Header */}
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600 }}>Catalog Sync</Typography>
                <Box
                  onClick={handleResync}
                  sx={{
                    fontSize: 11, fontWeight: 500, px: 1.25, py: 0.4,
                    borderRadius: '6px', cursor: resyncing ? 'default' : 'pointer',
                    bgcolor: 'var(--accent-ghost)', color: 'var(--accent)',
                    border: '0.5px solid var(--accent-border)',
                    opacity: resyncing ? 0.5 : 1, transition: 'opacity 0.2s',
                    userSelect: 'none',
                    '&:hover': { opacity: resyncing ? 0.5 : 0.75 },
                  }}
                >
                  {resyncing ? 'Syncing…' : '↻ Resync'}
                </Box>
              </Box>

              {/* Status + last synced */}
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: '50%',
                    bgcolor: isLive ? '#22C55E' : '#F59E0B',
                    boxShadow: isLive ? '0 0 4px rgba(34,197,94,0.6)' : '0 0 4px rgba(245,158,11,0.6)',
                  }} />
                  <Typography sx={{ fontSize: 11, color: isLive ? '#22C55E' : '#F59E0B', fontWeight: 500 }}>
                    {isLive ? 'Live' : 'Syncing'}
                  </Typography>
                </Box>
                <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                  {syncDetail?.lastSyncedAt ? `Updated ${formatTimeAgo(syncDetail.lastSyncedAt)}` : '—'}
                </Typography>
              </Box>

              {/* Counts strip */}
              {syncDetail && (
                <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
                  {[
                    { label: 'Products', value: syncDetail.counts.products },
                    { label: 'Variants', value: syncDetail.counts.variants },
                    { label: 'Orders', value: syncDetail.counts.orders },
                  ].map(({ label, value }) => (
                    <Box key={label} sx={{ flex: 1, textAlign: 'center', py: 0.75,
                      bgcolor: 'rgba(255,255,255,0.04)', borderRadius: '6px' }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{value}</Typography>
                      <Typography sx={{ fontSize: 10, color: 'text.secondary' }}>{label}</Typography>
                    </Box>
                  ))}
                </Box>
              )}

              {/* Recent products */}
              {syncDetail && syncDetail.recentProducts.length > 0 && (
                <>
                  <Typography sx={{ fontSize: 10, fontWeight: 600, color: 'text.secondary',
                    textTransform: 'uppercase', letterSpacing: 0.5, mb: 0.75 }}>
                    Recently synced
                  </Typography>
                  {syncDetail.recentProducts.map((p, i) => (
                    <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between',
                      alignItems: 'center', py: 0.5 }}>
                      <Typography sx={{ fontSize: 12, fontWeight: 500,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        maxWidth: 190 }}>
                        {p.title}
                      </Typography>
                      <Typography sx={{ fontSize: 11, color: 'text.secondary', flexShrink: 0, ml: 1 }}>
                        {formatTimeAgo(p.updated_at)}
                      </Typography>
                    </Box>
                  ))}
                </>
              )}

              {!syncDetail && (
                <Typography sx={{ fontSize: 12, color: 'text.secondary', textAlign: 'center', py: 1 }}>
                  Loading…
                </Typography>
              )}
            </Popover>
          </>
        )}
      </Box>
    </Box>
  );
};

export default TopnavbarContent;