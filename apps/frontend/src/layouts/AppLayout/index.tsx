// apps/frontend/src/layouts/AppLayout/index.tsx
import React, { ReactNode, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { axiosInstance } from "api/axiosConfig";
import { Box, Button, Drawer, IconButton, Typography, useMediaQuery } from "@mui/material";
import SidenavContent from "./SidenavContent";
import TopnavbarContent from "./TopnavbarContent";
import routes from "routes";
import { useShopLifecycle } from "lifecycle/ShopLifecycleContext";

import { ToastProvider } from "contexts/ToastContext";
import { useEntitlements } from 'contexts/EntitlementsContext';
import { useSystemHealth } from 'hooks/useSystemHealth';
import { SystemHealthBanner } from 'components/SystemHealthBanner';
import { PostTrialInterstitial } from '../../components/PostTrialInterstitial';
import { getWarehouseFocusSession } from '../../utils/warehouseFocus';
import { useAuth } from 'contexts/AuthContext';
import { useIdleTimeout } from 'hooks/useIdleTimeout';
import { ChevronLeft, LogOut, X } from "lucide-react";

interface AppLayoutProps {
  children?: ReactNode;
}

type SidenavState = 'EXPANDED' | 'COMPACT';

const SIDENAV_WIDTH_EXPANDED = 180;
const SIDENAV_WIDTH_COMPACT = 56;

// WS-UX-01 S5-A — below 768px the sidenav reserves no width and opens as an
// on-demand overlay. The desktop EXPANDED/COMPACT preference is untouched.
export const MOBILE_SHELL_QUERY = '(max-width: 767.98px)';
const MOBILE_NAV_WIDTH = 264;
const MOBILE_NAV_ID = 'mobile-navigation';


const AppLayout = (props: AppLayoutProps) => {

  const { phase } = useShopLifecycle();

  /**
   * WAREHOUSE-FOCUS-SHELL-01A — URL-backed execution-focus state.
   * No React context: AppLayout derives focus directly from the current
   * location's search params, so a hard refresh reconstructs the same
   * shell state the URL already encodes, with nothing else to rehydrate.
   *
   * Valid only on /wms routes, and only when warehouseFocus names the
   * matching session identity — a bare warehouseFocus param with no
   * matching task/job id (e.g. a stale/edited URL) must not hide chrome
   * for a session that isn't actually there. The rule itself is the
   * shared predicate WmsFT2Page also reads (utils/warehouseFocus).
   */
  const location = useLocation();
  const focusedSession = React.useMemo(() => {
    if (!location.pathname.startsWith('/wms')) return null;
    return getWarehouseFocusSession(new URLSearchParams(location.search));
  }, [location.pathname, location.search]);
  const isExecutionFocused = focusedSession !== null;
  // WAREHOUSE-SESSION-FOCUS-02A — a focused Pick hides post-trial
  // commercial chrome. Scoped to Pick in this slice:
  // stow/receive/count focus keeps its existing shell unchanged.
  // The system-health surface is never hidden by focus.
  const hideCommercialChrome = focusedSession === 'pick';
  const [isConnected, setIsConnected] = useState(false);
  const { trialEndsAt, tier } = useEntitlements();
  // Post-trial: trial ended within last 7 days and user is now on starter
  const isPostTrial = tier === 'starter' && trialEndsAt !== null &&
    new Date(trialEndsAt) < new Date() &&
    (Date.now() - new Date(trialEndsAt).getTime()) < 7 * 24 * 60 * 60 * 1000;
  const [sidenavState, setSidenavState] = useState<SidenavState>(() => {
    const saved = localStorage.getItem('sidenavState') as SidenavState | null;
    // Migrate legacy 'CLOSED' value from pre-refactor storage
    if (!saved || saved === ('CLOSED' as string)) return 'EXPANDED';
    return saved;
  });
  const { logout, user } = useAuth();

  // ACCESS-01: operators work in task-oriented /wms surfaces with no
  // application chrome. Role-driven, independent of execution focus; route
  // admission stays owned by ProtectedRoute. These visibility booleans are
  // the single source for both rendering chrome and reserving its space.
  const isOperator = user?.role === 'operator';
  const navigate = useNavigate();

  // GH-1222: operators have no topnav/sidenav, so the shell owns their only
  // session control. Same contract as ProfileSection: the logout request is
  // non-fatal; the local session is always cleared and the user lands on /login.
  const operatorIdentity = user?.first_name
    ? `${user.first_name}${user.last_name ? ' ' + user.last_name : ''}`
    : user?.email ?? 'Signed in';
  const handleOperatorLogout = async () => {
    await logout();
    navigate('/login');
  };
  // Idle timeout — log out after 15min of inactivity, save route for return-to on re-login.
  useIdleTimeout(() => {
    const currentPath = window.location.pathname + window.location.search;
    if (currentPath !== '/login') sessionStorage.setItem('returnTo', currentPath);
    void logout();
  });
  /**
   * LIFECYCLE → SIDENAV VISIBILITY CONTRACT
   * - FT_MINUS_ONE, FT0, FT1 → sidenav must NOT exist
   * - FT2 → sidenav allowed
  */
  const isSidenavAllowed = phase === 'FT2_READY';
  const showTopnav = !isExecutionFocused && !isOperator;
  const showSidenav = isSidenavAllowed && !isExecutionFocused && !isOperator;
  const hasAutoOpenedRef = React.useRef(false); // audit: prevent re-open after manual close

  /**
   * WS-UX-01 S5-A — MOBILE SHELL
   * Viewport only decides presentation: the same showSidenav gate admits
   * the overlay, and only one SidenavContent is ever mounted. The drawer
   * starts closed, closes after any navigation and whenever the viewport
   * leaves mobile, and never writes the desktop preference.
   */
  const isMobileShell = useMediaQuery(MOBILE_SHELL_QUERY, { noSsr: true });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const showDesktopSidenav = showSidenav && !isMobileShell;
  const showMobileNav = showSidenav && isMobileShell;

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.key]);

  useEffect(() => {
    if (!showMobileNav) setMobileNavOpen(false);
  }, [showMobileNav]);

  /**
   * SYSTEM HEALTH
   * --------------------
   * Only poll during FT2 — no health surface needed in earlier phases.
   * Passes isSidenavAllowed as the enabled gate (FT2 === sidenav allowed).
   */
  const { data: systemHealth } = useSystemHealth(isSidenavAllowed);

  /**
   * LIFECYCLE VISIBILITY GUARD
   * -------------------------
   * Lifecycle controls whether sidenav may exist.
   * User controls expanded / compact / closed while FT2 is active.
   *
   * This prevents lifecycle from overriding toggle actions.
   */
  useEffect(() => {
    // Outside FT2: sidenav visibility is controlled by isSidenavAllowed gate.
    // No state mutation needed — preserves user preference across phase changes.
    const isDefinitelyNotFt2 = phase === 'FT_MINUS_ONE' || phase === 'FT1' || phase === 'FT1_READY' || phase === 'FT0' || phase === 'FT0_PREPARING';
    if (isDefinitelyNotFt2) return;

    // First FT2 entry: restore saved preference or default to EXPANDED.
    if (isSidenavAllowed && !hasAutoOpenedRef.current) {
      hasAutoOpenedRef.current = true;
      const savedOnFt2Entry = localStorage.getItem('sidenavState') as SidenavState | null;
      const isValid = savedOnFt2Entry === 'EXPANDED' || savedOnFt2Entry === 'COMPACT';
      setSidenavState(isValid ? savedOnFt2Entry : 'EXPANDED');
      /* console.info('[SIDENAV][RESTORE_ON_FT2_ENTRY]', { phase, restored: isValid ? savedOnFt2Entry : 'EXPANDED' }); */
    }
  }, [isSidenavAllowed, phase, sidenavState]);

  /**
   * SIDENAV STATE PERSISTENCE
   * -------------------------
   * Ensures user preference survives refresh.
   */
  useEffect(() => {
    localStorage.setItem('sidenavState', sidenavState);

    /* console.info('[SIDENAV][PERSIST]', { sidenavState }); */
  }, [sidenavState]);

  const sidenavWidth = sidenavState === 'EXPANDED'
    ? SIDENAV_WIDTH_EXPANDED
    : SIDENAV_WIDTH_COMPACT;

  // Connectivity check
  useEffect(() => {
    const fetchLayout = async () => {
      try {
        await axiosInstance.get("/api/v1/layouts/dashboard");
        setIsConnected(true);
      } catch {
        setIsConnected(false);
      }
    };

    fetchLayout();
  }, []);

/* console.log('[APP_LAYOUT_RENDER]', {
    phase,
    isSidenavAllowed,
    sidenavState,
    sidenavWidth,
  }); */

  return (
    <ToastProvider>
      <Box sx={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column", bgcolor: "var(--bg)" }}>

        {/* TOP NAVBAR — full width, always on top. Hidden while an
            operator is actively executing a Stow/Receive session
            (WAREHOUSE-FOCUS-SHELL-01A) — presentation only, not an
            authorization boundary. */}
        {showTopnav && (
          <Box sx={{ height: "48px", flexShrink: 0, borderBottom: "0.5px solid var(--rule)", zIndex: 1200, display: "flex", alignItems: "center" }}>
            <TopnavbarContent
              isEditing={false}
              onEditToggle={() => {}}
              onAddWidget={() => {}}
              onToggleSidenav={
                isSidenavAllowed
                  ? () => setSidenavState(prev => prev === 'EXPANDED' ? 'COMPACT' : 'EXPANDED')
                  : () => { console.warn('[SIDENAV][BLOCKED_TOGGLE]', { phase }); }
              }
              mobileNav={showMobileNav ? { open: mobileNavOpen, controlsId: MOBILE_NAV_ID, onOpen: () => setMobileNavOpen(true) } : undefined}
            />
          </Box>
        )}

        {/* MOBILE NAVIGATION (WS-UX-01 S5-A) — modal overlay below 768px.
            MUI Modal supplies the focus trap, Escape/backdrop dismissal,
            inert background and focus return to the header trigger. */}
        {showMobileNav && (
          <Drawer
            variant="temporary"
            anchor="left"
            open={mobileNavOpen}
            onClose={() => setMobileNavOpen(false)}
            slotProps={{
              paper: {
                id: MOBILE_NAV_ID,
                role: 'dialog',
                'aria-modal': true,
                'aria-label': 'Main navigation',
                sx: {
                  width: MOBILE_NAV_WIDTH,
                  maxWidth: '85vw',
                  bgcolor: 'var(--bg)',
                  borderRight: '1px solid var(--rule)',
                  display: 'flex',
                  flexDirection: 'column',
                  // Touch: every navigation control in the overlay is >= 44px.
                  '@media (pointer: coarse)': {
                    '& .MuiListItemButton-root, & .MuiButtonBase-root, & [role="button"]': { minHeight: 44 },
                  },
                },
              },
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', px: 0.5, height: 48, flexShrink: 0, borderBottom: '0.5px solid var(--rule)' }}>
              <IconButton
                aria-label="Close navigation"
                onClick={() => setMobileNavOpen(false)}
                sx={{ width: 44, height: 44, color: 'var(--ink-3)' }}
              >
                <X size={18} strokeWidth={1.75} />
              </IconButton>
            </Box>
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <SidenavContent
                brandName="LaSyncro"
                routes={routes}
                sidenavState="EXPANDED"
                isConnected={isConnected}
                isFt2Ready={isSidenavAllowed}
              />
            </Box>
          </Drawer>
        )}

        {/* BELOW TOPNAV — sidenav + content side by side */}
        <Box sx={{ flexGrow: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>

          {/* SIDENAV — below topnav, full remaining height. Hidden while
              execution-focused, same as the topnav above. Does not mutate
              the saved sidenavState preference — it reappears exactly as
              the operator left it once focus clears. */}
          {showDesktopSidenav && (
            <Box
              sx={{
                width: `${sidenavWidth}px`,
                minWidth: `${sidenavWidth}px`,
                maxWidth: `${sidenavWidth}px`,
                height: "100%",
                borderRight: "1px solid var(--rule)",
                display: 'flex',
                flexDirection: "column",
                transition: "width 0.2s ease",
                flexShrink: 0,
                position: 'relative',
              }}
            >
              <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <SidenavContent
                  brandName="LaSyncro"
                  routes={routes}
                  sidenavState={sidenavState}
                  isConnected={isConnected}
                  isFt2Ready={isSidenavAllowed}
                />
              </Box>
              {/* SIDENAV HANDLEBAR — fixed to right edge, vertically centered
              Toggles EXPANDED ↔ COMPACT. Minimal but always discoverable. */}
              <Box
                onClick={() => setSidenavState(prev => prev === 'EXPANDED' ? 'COMPACT' : 'EXPANDED')}
                sx={{
                  position: 'absolute',
                  right: -8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 16,
                  height: 32,
                  borderRadius: '0 4px 4px 0',
                  bgcolor: 'var(--bg-3)',
                  border: '1px solid var(--rule)',
                  borderLeft: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  zIndex: 10,
                  color: 'var(--ink-4)',
                  transition: 'color 0.15s, background 0.15s',
                  '&:hover': {
                    bgcolor: 'var(--bg-3)',
                    color: 'var(--ink)',
                  },
                }}
              >
                <ChevronLeft size={10} strokeWidth={3} style={{ transform: sidenavState === 'COMPACT' ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
              </Box>
            </Box>
          )}

          {/* MAIN CONTENT AREA */}
          <Box sx={{ flexGrow: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>

            {/* SYSTEM HEALTH BANNER (H-01) — FT2 only */}
            {isSidenavAllowed && systemHealth && (
              <SystemHealthBanner
                status={systemHealth.status}
                lagSeconds={systemHealth.snapshot?.lag_seconds}
              />
            )}

            {/* OPERATOR SESSION CONTROL (GH-1222) — identity + Log out only.
                Role-driven and independent of execution focus, so it stays
                available during focused warehouse sessions. Deliberately not
                a topnav: no navigation, settings, billing or theme. */}
            {isOperator && (
              <Box
                data-testid="operator-session-control"
                sx={{
                  display: "flex",
                  justifyContent: "flex-end",
                  alignItems: "center",
                  gap: 1,
                  px: 2,
                  py: 0.75,
                  flexShrink: 0,
                }}
              >
                <Typography sx={{ fontSize: 12, color: "var(--ink-3)", whiteSpace: "nowrap" }}>
                  {operatorIdentity}
                </Typography>
                <Button
                  size="small"
                  variant="text"
                  onClick={() => void handleOperatorLogout()}
                  startIcon={<LogOut size={14} strokeWidth={1.75} />}
                  sx={{ fontSize: 12, color: "var(--ink-3)", textTransform: "none", minWidth: 0, px: 1 }}
                >
                  Log out
                </Button>
              </Box>
            )}

            {/* POST-TRIAL INTERSTITIAL (UX-07) — owner/admin only, as above */}
            <PostTrialInterstitial show={isPostTrial && !isOperator && !hideCommercialChrome} />

            {/* PAGE CONTENT */}
            <Box
              sx={{
                flexGrow: 1,
                minWidth: 0,
                width: "100%",
                maxWidth: "100%",
                overflowY: "auto",
                overflowX: "hidden",
                position: "relative",
              }}
            >
              {props.children}
            </Box>
          </Box>
        </Box>
      </Box>
    </ToastProvider>
  );
};

export default AppLayout;