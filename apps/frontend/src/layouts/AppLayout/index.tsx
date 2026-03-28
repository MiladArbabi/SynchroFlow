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
  const [sidenavState, setSidenavState] = useState<SidenavState>('CLOSED'); // default safe state
  /**
   * LIFECYCLE → SIDENAV VISIBILITY CONTRACT
   * - FT_MINUS_ONE, FT0, FT1 → sidenav must NOT exist
   * - FT2 → sidenav allowed
  */
 const isSidenavAllowed = phase === 'FT2_READY';

  /**
   * LIFECYCLE-DRIVEN SIDENAV STATE
   * ------------------------------
   * FT2_READY => always expanded
   * all other phases => always closed
   *
   * Single source of truth = lifecycle phase
   */
  useEffect(() => {
    const targetState: SidenavState =
      isSidenavAllowed ? 'EXPANDED' : 'CLOSED';

    if (sidenavState !== targetState) {
      console.info('[SIDENAV][LIFECYCLE_SYNC]', {
        phase,
        from: sidenavState,
        to: targetState,
      });

      setSidenavState(targetState);
    }
  }, [isSidenavAllowed, phase, sidenavState]);

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
      <Box sx={{ width: "100vw", height: "100vh", display: "flex" }}>
        
        {/* SIDENAV */}
        {isSidenavAllowed && (
        <Box
          sx={{
            width: `${sidenavWidth}px`,
            minWidth: `${sidenavWidth}px`,
            maxWidth: `${sidenavWidth}px`,
            height: "100%",
            borderRight: sidenavState !== 'CLOSED' ? "1px solid #e0e0e0" : "none",
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
              borderBottom: "1px solid #e0e0e0"
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

          {/* LAYOUT GUARD: prevent module surfaces from widening viewport */}
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