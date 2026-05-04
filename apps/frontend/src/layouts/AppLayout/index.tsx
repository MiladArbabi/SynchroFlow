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

interface AppLayoutProps {
  children?: ReactNode;
  isConnectModalOpen: boolean;
  onCloseConnectModal: () => void;
}

type SidenavState = 'EXPANDED' | 'COMPACT' | 'CLOSED';

const SIDENAV_WIDTH_EXPANDED = 180;
const SIDENAV_WIDTH_COMPACT = 75;
const SIDENAV_WIDTH_CLOSED = 0;


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

  console.info('[SIDENAV][INIT_FROM_STORAGE]', { saved });

    return saved ?? 'CLOSED';
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
    // Only force-close when phase is definitively non-FT2.
    // 'FT_MINUS_ONE' and 'FT1'/'FT1_READY' are stable non-FT2 phases.
    // Never force-close during boot (phase undefined/null) — would destroy
    // persisted COMPACT state before FT2 is confirmed.
    const isDefinitelyNotFt2 = phase === 'FT_MINUS_ONE' || phase === 'FT1' || phase === 'FT1_READY' || phase === 'FT0' || phase === 'FT0_PREPARING';
    if (isDefinitelyNotFt2 && sidenavState !== 'CLOSED') {
      console.info('[SIDENAV][FORCE_CLOSE_OUTSIDE_FT2]', {
        phase,
        from: sidenavState,
        to: 'CLOSED',
      });
      setSidenavState('CLOSED');
    }

    // On first FT2 entry, clear any stale FT1-era 'CLOSED' preference
    // so the sidenav opens automatically for the merchant's first FT2 experience.
    if (isSidenavAllowed && !hasAutoOpenedRef.current) {
      hasAutoOpenedRef.current = true;
      const savedOnFt2Entry = localStorage.getItem('sidenavState') as SidenavState | null;
      if (!savedOnFt2Entry) {
        // No prior preference — first ever FT2 entry, open expanded
        console.info('[SIDENAV][AUTO_OPEN_ON_FT2_ENTRY]', { phase });
        setSidenavState('EXPANDED');
      } else {
        // Restore exact user preference — EXPANDED, COMPACT, or CLOSED
        console.info('[SIDENAV][RESTORE_ON_FT2_ENTRY]', { phase, restored: savedOnFt2Entry });
        setSidenavState(savedOnFt2Entry);
      }
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

  const sidenavWidth =
  sidenavState === 'EXPANDED'
    ? SIDENAV_WIDTH_EXPANDED
    : sidenavState === 'COMPACT'
    ? SIDENAV_WIDTH_COMPACT
    : SIDENAV_WIDTH_CLOSED;

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
      <Box sx={{ width: "100vw", height: "100vh", display: "flex", bgcolor: "var(--bg)" }}>
        
        {/* SIDENAV */}
        {isSidenavAllowed && (
        <Box
          sx={{
            width: `${sidenavWidth}px`,
            minWidth: `${sidenavWidth}px`,
            maxWidth: `${sidenavWidth}px`,
            height: "100%",
            borderRight: sidenavState !== 'CLOSED' ? "1px solid var(--rule)" : "none",
            display: sidenavState === 'CLOSED' ? 'none' : 'flex',
            flexDirection: "column",
            overflow: "hidden",
            transition: "width 0.2s ease"
          }}
        >
          <SidenavContent
            brandName="LaSyncro"
            routes={routes}
            sidenavState={sidenavState}
            isConnected={isConnected}
          />
        </Box>
      )}

        {/* MAIN AREA */}
        <Box sx={{ flexGrow: 1, display: "flex", flexDirection: "column" }}>
          
          {/* TOP NAVBAR */}
          <Box
            sx={{
              height: "60px",
              flexShrink: 0,
              borderBottom: "1px solid var(--rule)"
            }}
          >
            {/* TOPNAVBAR (toggle disabled outside FT2_READY) */}
            <TopnavbarContent
              isEditing={false}
              onEditToggle={() => {}}
              onAddWidget={() => {}}
              onToggleSidenav={
                isSidenavAllowed
                  ? () => {
                      setSidenavState(prev =>
                        prev === 'EXPANDED'
                          ? 'COMPACT'
                          : prev === 'COMPACT'
                          ? 'CLOSED'
                          : 'EXPANDED'
                      );
                    }
                  : () => {
                      console.warn('[SIDENAV][BLOCKED_TOGGLE]', { phase });
                    }
              }
            />
          </Box>

          {/* SYSTEM HEALTH BANNER (H-01) — FT2 only */}
          {isSidenavAllowed && systemHealth && (
            <SystemHealthBanner
              status={systemHealth.status}
              lagSeconds={systemHealth.snapshot?.lag_seconds}
            />
          )}

          {/* TRIAL COUNTDOWN BANNER (UX-03) */}
          <TrialCountdownBanner trialEndsAt={trialEndsAt} />
          {/* POST-TRIAL INTERSTITIAL (UX-07) */}
          <PostTrialInterstitial show={isPostTrial} />

          {/* CONTENT AREA */}
          <Box
            sx={{
              flexGrow: 1,
              minWidth: 0,
              width: "100%",
              maxWidth: "100%",
              overflowY: "auto",
              overflowX: "hidden",
              position: "relative"
            }}
          >
            {props.children}
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