// apps/frontend/src/layouts/AppLayout/index.tsx
import React, { ReactNode, useEffect, useState } from "react";
import { axiosInstance } from "api/axiosConfig";
import { Box } from "@mui/material";
import SidenavContent from "./SidenavContent";
import TopnavbarContent from "./TopnavbarContent";
import routes from "routes";

import { ToastProvider } from "contexts/ToastContext";
import { Ft1Outlet } from "lifecycle/Ft1Outlet";

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
  const [isConnected, setIsConnected] = useState(false);
  const [sidenavState, setSidenavState] = useState<SidenavState>('EXPANDED');

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

  return (
    <ToastProvider>
      <Box sx={{ width: "100vw", height: "100vh", display: "flex" }}>
        
        {/* SIDENAV */}
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
            <TopnavbarContent
              isEditing={false}
              onEditToggle={() => {}}
              onAddWidget={() => {}}
              onToggleSidenav={() => {
                setSidenavState(prev =>
                  prev === 'EXPANDED'
                    ? 'COMPACT'
                    : prev === 'COMPACT'
                    ? 'CLOSED'
                    : 'EXPANDED'
                );
              }}
            />
          </Box>

          {/* CONTENT AREA */}
          <Box
            sx={{
              flexGrow: 1,
              overflowY: "auto",
              position: "relative"
            }}
          >
            <Ft1Outlet />
            {props.children}
          </Box>
        </Box>
      </Box>
    </ToastProvider>
  );
};

export default AppLayout;