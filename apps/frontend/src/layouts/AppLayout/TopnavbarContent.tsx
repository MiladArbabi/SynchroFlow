/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/layouts/AppLayout/TopnavbarContent.tsx
import React, { useState } from "react";
import { useLocation, Link as RouterLink, useNavigate } from "react-router-dom";
import { getBreadcrumbLabel } from "runtime/registerNav";
import {
  Box, Typography, Breadcrumbs as MuiBreadcrumbs,
  Link, Tooltip, Popover, IconButton,
} from "@mui/material";
import { useColorScheme } from "@mui/material/styles";
import { Home, Menu } from 'lucide-react';
import { OpsConsoleButton } from '../../components/OpsConsole';
import { useAlerts } from '../../pages/alerts/useAlerts';
import { useShopLifecycle } from 'lifecycle/ShopLifecycleContext';
import { useAuth } from '../../contexts/AuthContext';
import { useBillingUsage } from '../../hooks/useBillingUsage';
import { ShopifyConnectionBadge } from '../../components/ShopifyConnectionBadge/ShopifyConnectionBadge';

// ─── TOPNAV COMPONENT ─────────────────────────────────────────────────────────

interface TopnavbarContentProps {
  isEditing: boolean;
  onEditToggle: () => void;
  onAddWidget: () => void;
  onToggleSidenav: () => void;
  /** WS-UX-01 S5-A — present only while AppLayout shows the mobile overlay nav. */
  mobileNav?: { open: boolean; controlsId: string; onOpen: () => void };
}

const TopnavbarContent: React.FC<TopnavbarContentProps> = ({ onToggleSidenav, mobileNav }) => {
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

  const { data: billingUsage } = useBillingUsage({
    enabled: isFt2 && isOwner,
    poll: isFt2 && isOwner,
  });

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
      '@media (max-width: 767.98px)': { padding: "0 4px 0 2px" },
    }}>
      {/* LEFT — LOGO + BREADCRUMBS */}
      <Box sx={{ display: "flex", alignItems: "center", minWidth: 0, flex: "1 1 auto", overflow: "hidden" }}>
        {mobileNav && (
          <IconButton
            aria-label="Open navigation"
            aria-haspopup="dialog"
            aria-controls={mobileNav.controlsId}
            aria-expanded={mobileNav.open}
            onClick={mobileNav.onOpen}
            sx={{ width: 44, height: 44, flexShrink: 0, color: 'var(--ink-2)', borderRadius: '8px' }}
          >
            <Menu size={20} strokeWidth={1.75} />
          </IconButton>
        )}
        <Box
          component="img"
          src={mode === 'dark' ? '/logo-dark.png' : '/logo.png'}
          alt="LaSyncro"
          sx={{
            height: 22, width: 'auto', display: 'block', mr: 2, ml: 1, flexShrink: 0,
            '@media (max-width: 767.98px)': { mr: 1, ml: 0 },
          }}
        />
        <MuiBreadcrumbs
          aria-label="breadcrumb"
          sx={{
            minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
            // WS-UX-01 S5-A — one line on mobile: labels truncate, Home never shrinks.
            '@media (max-width: 767.98px)': {
              '& .MuiBreadcrumbs-ol': { flexWrap: 'nowrap' },
              '& .MuiBreadcrumbs-li': { minWidth: 0, overflow: 'hidden' },
              '& .MuiBreadcrumbs-li:first-of-type, & .MuiBreadcrumbs-separator': { flexShrink: 0 },
              '& .MuiBreadcrumbs-separator': { mx: '4px' },
            },
          }}
        >
          <Link component={RouterLink} to="/" underline="none" aria-label="Home" sx={{
            display: 'flex', alignItems: 'center',
            color: 'var(--ink-3)', '&:hover': { color: 'var(--ink)' },
            '@media (pointer: coarse) and (max-width: 767.98px)': { minWidth: 44, minHeight: 44, justifyContent: 'center' },
          }}>
            <Home size={14} strokeWidth={1.75} />
          </Link>
          {crumb?.parentLabel && (
            <Typography noWrap sx={{ fontSize: 13, color: 'var(--ink-3)' }}>
              {crumb.parentLabel}
            </Typography>
          )}
          <Typography noWrap sx={{ fontSize: 13, fontWeight: 500, color: 'var(--accent-text)' }}>
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
                      color: 'var(--accent-text)',
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
                      sx={{ mt: 0.5, fontSize: 12, fontWeight: 700, color: 'var(--accent-text)', cursor: 'pointer' }}
                    >
                      Go to billing →
                    </Box>
                  </Box>
                </Popover>
              </>
            )}
          </>
        )}

        {isFt2 && <ShopifyConnectionBadge />}
      </Box>
    </Box>
  );
};

export default TopnavbarContent;
