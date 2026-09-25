/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/layouts/AppLayout/TopnavbarContent.tsx
import React, { useState } from "react";
import { useLocation, Link as RouterLink, useNavigate } from "react-router-dom";
import { getBreadcrumbLabel } from "runtime/registerNav";
import {
  Box, Typography, Breadcrumbs as MuiBreadcrumbs,
  Link, Tooltip, Popover,
} from "@mui/material";
import { useColorScheme } from "@mui/material/styles";
import { TrialCountdownChip } from 'components/TrialCountdownChip';
import { Home } from 'lucide-react';
import { OpsConsoleButton } from '../../components/OpsConsole';
import { useAlerts } from '../../pages/alerts/useAlerts';
import { useShopLifecycle } from 'lifecycle/ShopLifecycleContext';
import { useIntegration } from '../../contexts/integration/useIntegration';
import { axiosInstance } from "api/axiosConfig";
import { useAuth } from '../../contexts/AuthContext';
import { useBillingUsage } from '../../hooks/useBillingUsage';

// ─── TOPNAV COMPONENT ─────────────────────────────────────────────────────────

interface TopnavbarContentProps {
  isEditing: boolean;
  onEditToggle: () => void;
  onAddWidget: () => void;
  onToggleSidenav: () => void;
}

const TopnavbarContent: React.FC<TopnavbarContentProps> = ({ onToggleSidenav }) => {
  const location  = useLocation();
  const navigate = useNavigate();
  // Read-only here: the logo follows the scheme. The theme control itself
  // lives in the sidenav footer (GH-1158).
  const { mode } = useColorScheme();
  const { user } = useAuth();
  const { phase } = useShopLifecycle();
  const isFt2     = phase === 'FT2_READY';
  const isOwner = user?.role === 'owner';
  const [usageAnchor, setUsageAnchor] = useState<null | HTMLElement>(null);

  // Alerts is an FT2-protected surface, and the topnav remains the SINGLE
  // shell-level owner of the live inbox poll. The bell popover that used to
  // render this data here is gone (OPS-CONSOLE-01: the Ops Console is now the
  // only top-nav attention surface), but the OWNERSHIP stays: this component is
  // mounted across the whole authenticated AppLayout (persists over /overview
  // and /alerts), so `poll: true` here gives the 30s cadence one owner. Every
  // other consumer (Ops Console NOW, sidenav badge, module-health dot,
  // AlertsPage) reads the same canonical ['alerts', { status: 'inbox' }] cache
  // entry without scheduling its own interval. `enabled: isFt2` keeps FT1 fully
  // silent — no request, retry, poll or focus refetch before confirmed FT2.
  const { data: alertsData } = useAlerts(
    { status: 'inbox' },
    { enabled: isFt2, poll: true },
  );
  // Handed to the Ops Console exactly once — it opens no inbox query of its own.
  const allInbox     = alertsData?.data ?? [];

  const { isSyncComplete, integrationId, refresh } = useIntegration();
  const { data: billingUsage } = useBillingUsage({
    enabled: isFt2 && isOwner,
    poll: isFt2 && isOwner,
  });
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

  const formatMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const isBillingOverage = Boolean(billingUsage && billingUsage.overage_units > 0);
  const isBillingAllowanceUsed = Boolean(
    billingUsage &&
    billingUsage.overage_units === 0 &&
    billingUsage.processed_orders >= billingUsage.included_allowance
  );
  const showBillingUsage =
    isFt2 &&
    isOwner &&
    Boolean(billingUsage) &&
    billingUsage!.included_allowance > 0 &&
    (billingUsage!.usage_percent >= 60 || billingUsage!.overage_units > 0);

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
            {/* OPS CONSOLE — persistent right-side operational rail, left of bell.
                Receives the canonical inbox alerts this component already owns,
                so NOW is backed by live truth without a second poll. */}
            <OpsConsoleButton alerts={allInbox} />

            <TrialCountdownChip />

            {showBillingUsage && billingUsage && (
              <>
                <Tooltip title={`${billingUsage.usage_percent}% of included processed orders used`}>
                  <Box
                    onClick={(e) => setUsageAnchor(e.currentTarget)}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 0.45,
                      px: 1, py: 0.375, borderRadius: '20px', flexShrink: 0,
                      bgcolor: 'rgba(99,102,241,0.08)',
                      border: '0.5px solid rgba(99,102,241,0.28)',
                      cursor: 'pointer',
                      color: 'var(--accent)',
                    }}
                  >
                    <Typography sx={{ fontSize: 12, lineHeight: 1 }}>◔</Typography>
                    <Typography sx={{ fontSize: 11, fontWeight: 600, lineHeight: 1 }}>
                      {billingUsage.overage_units > 0 ? '100%' : `${billingUsage.usage_percent}%`}
                    </Typography>
                  </Box>
                </Tooltip>

                <Popover
                  open={Boolean(usageAnchor)}
                  anchorEl={usageAnchor}
                  onClose={() => setUsageAnchor(null)}
                  anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                  transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                  slotProps={{ paper: {
                    sx: { mt: 1, width: 280, borderRadius: '10px', p: 2,
                      bgcolor: 'background.paper', boxShadow: '0 4px 24px rgba(0,0,0,0.18)' }
                  }}}
                >
                  <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 1 }}>
                    {isBillingOverage ? 'Overage active' : isBillingAllowanceUsed ? 'Included allowance used' : billingUsage.usage_percent >= 90 ? 'Approaching your allowance' : 'Processed orders'}
                  </Typography>
                  <Box sx={{ display: 'grid', gap: 0.75 }}>
                    {isBillingOverage ? (
                      <>
                        <Typography sx={{ fontSize: 12 }}>{billingUsage.processed_orders.toLocaleString('en-US')} processed orders</Typography>
                        <Typography sx={{ fontSize: 12 }}>{billingUsage.overage_units.toLocaleString('en-US')} additional</Typography>
                        <Typography sx={{ fontSize: 12, fontWeight: 600 }}>Estimated overage {formatMoney(billingUsage.estimated_overage_cents)}</Typography>
                      </>
                    ) : isBillingAllowanceUsed ? (
                      <>
                        <Typography sx={{ fontSize: 12 }}>{billingUsage.processed_orders.toLocaleString('en-US')} / {billingUsage.included_allowance.toLocaleString('en-US')}</Typography>
                        <Typography sx={{ fontSize: 12 }}>Your included processed-order allowance has been used.</Typography>
                        <Typography sx={{ fontSize: 12 }}>Processing continues normally.</Typography>
                      </>
                    ) : (
                      <>
                        <Typography sx={{ fontSize: 12 }}>{billingUsage.processed_orders.toLocaleString('en-US')} / {billingUsage.included_allowance.toLocaleString('en-US')}</Typography>
                        <Typography sx={{ fontSize: 12 }}>{billingUsage.remaining_included.toLocaleString('en-US')} remaining</Typography>
                      </>
                    )}
                    {billingUsage.period_ends_at && (
                      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                        Resets {new Date(billingUsage.period_ends_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </Typography>
                    )}
                    {billingUsage.overage_rate_cents != null && (
                      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                        {isBillingAllowanceUsed ? 'Additional orders' : 'Additional orders after allowance'}: {formatMoney(billingUsage.overage_rate_cents)} each
                      </Typography>
                    )}
                    <Box
                      onClick={() => {
                        setUsageAnchor(null);
                        navigate('/settings/billing');
                      }}
                      sx={{ mt: 0.5, fontSize: 12, fontWeight: 700, color: 'var(--accent)', cursor: 'pointer' }}
                    >
                      Go to billing →
                    </Box>
                  </Box>
                </Popover>
              </>
            )}
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
