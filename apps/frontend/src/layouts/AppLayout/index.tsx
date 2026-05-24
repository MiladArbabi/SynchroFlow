// apps/frontend/src/layouts/AppLayout/index.tsx
import React, { ReactNode, useEffect, useState } from "react";
import { axiosInstance } from "api/axiosConfig";
import { Box } from "@mui/material";
import SidenavContent from "./SidenavContent";
import TopnavbarContent from "./TopnavbarContent";
import routes from "routes";
import { useShopLifecycle } from "lifecycle/ShopLifecycleContext";

import { ToastProvider } from "contexts/ToastContext";
import { ConnectStoreModal } from "components/ConnectStoreModal";

import { useEntitlements } from 'contexts/EntitlementsContext';
import { useSystemHealth } from 'hooks/useSystemHealth';
import { SystemHealthBanner } from 'components/SystemHealthBanner';
import { TrialCountdownBanner } from "../../components/TrialCountdownBanner";
import { PostTrialInterstitial } from '../../components/PostTrialInterstitial';
import { useAuth } from 'contexts/AuthContext';
import { useIdleTimeout } from 'hooks/useIdleTimeout';
import { ChevronLeft } from "lucide-react";

interface AppLayoutProps {
  children?: ReactNode;
  isConnectModalOpen: boolean;
  onCloseConnectModal: () => void;
}

type SidenavState = 'EXPANDED' | 'COMPACT';

const SIDENAV_WIDTH_EXPANDED = 180;
const SIDENAV_WIDTH_COMPACT = 56;


const AppLayout = (props: AppLayoutProps) => {

  const { phase } = useShopLifecycle();
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
  const { logout } = useAuth();
  // Idle timeout — log out after 15min of inactivity, save route for return-to on re-login.
  useIdleTimeout(() => {
    const currentPath = window.location.pathname + window.location.search;
    if (currentPath !== '/login') sessionStorage.setItem('returnTo', currentPath);
    logout();
  });
  /**
   * LIFECYCLE → SIDENAV VISIBILITY CONTRACT
   * - FT_MINUS_ONE, FT0, FT1 → sidenav must NOT exist
   * - FT2 → sidenav allowed
  */
  const isSidenavAllowed = phase === 'FT2_READY';
  const hasAutoOpenedRef = React.useRef(false); // audit: prevent re-open after manual close

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
      console.info('[SIDENAV][RESTORE_ON_FT2_ENTRY]', { phase, restored: isValid ? savedOnFt2Entry : 'EXPANDED' });
    }
  }, [isSidenavAllowed, phase, sidenavState]);

  /**
   * SIDENAV STATE PERSISTENCE
   * -------------------------
   * Ensures user preference survives refresh.
   */
  useEffect(() => {
    localStorage.setItem('sidenavState', sidenavState);

    console.info('[SIDENAV][PERSIST]', { sidenavState });
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

        {/* TOP NAVBAR — full width, always on top */}
        <Box sx={{ height: "48px", flexShrink: 0, borderBottom: "1px solid var(--rule)", zIndex: 1200 }}>
          <TopnavbarContent
            isEditing={false}
            onEditToggle={() => {}}
            onAddWidget={() => {}}
            onToggleSidenav={
              isSidenavAllowed
                ? () => setSidenavState(prev => prev === 'EXPANDED' ? 'COMPACT' : 'EXPANDED')
                : () => { console.warn('[SIDENAV][BLOCKED_TOGGLE]', { phase }); }
            }
          />
        </Box>

        {/* BELOW TOPNAV — sidenav + content side by side */}
        <Box sx={{ flexGrow: 1, display: "flex", overflow: "hidden" }}>

          {/* SIDENAV — below topnav, full remaining height */}
          {isSidenavAllowed && (
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
          <Box sx={{ flexGrow: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

            {/* SYSTEM HEALTH BANNER (H-01) — FT2 only */}
            {isSidenavAllowed && systemHealth && (
              <SystemHealthBanner
                status={systemHealth.status}
                lagSeconds={systemHealth.snapshot?.lag_seconds}
              />
            )}

            {/* Trial banner — FT2 only */}
            {isSidenavAllowed && <TrialCountdownBanner trialEndsAt={trialEndsAt} />}

            {/* POST-TRIAL INTERSTITIAL (UX-07) */}
            <PostTrialInterstitial show={isPostTrial} />

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

      <ConnectStoreModal
        isOpen={props.isConnectModalOpen}
        onClose={props.onCloseConnectModal}
      />
    </ToastProvider>
  );
};

export default AppLayout;