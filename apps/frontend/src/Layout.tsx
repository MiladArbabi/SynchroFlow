/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/Layout.tsx
import { useState, useEffect } from "react";
import { useLocation, Outlet } from "react-router-dom";
import Sidenav from './layouts/AppLayout/SidenavContent'
// Import the correct components from react-resizable-panels
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
} from "react-resizable-panels";
import routes from "routes";

export default function Layout() {
    const [isSidenavOpen, setSidenavOpen] = useState(true);
    const { pathname } = useLocation();

    // Set the document layout for the main page
    useEffect(() => {
        document.body.setAttribute("layout", "dashboard");
    }, [pathname]);

    // Replace root <Box> with PanelGroup
    return (
        <PanelGroup
          direction="horizontal"
          style={{ height: '100vh', width: '100vw' }}
        >
            {/* === MASTER PANEL (Sidenav) === */}
            <Panel
              defaultSize={20}
              minSize={18}
              maxSize={25}
              role="group" // For the test
            >
                <Sidenav
                  brandName="SynchroFlow"
                  routes={routes}
                  isSidenavOpen={isSidenavOpen} isConnected={false} 
                  onOpenModal={() => {
                    window.dispatchEvent(new CustomEvent('ui:connect-store'));
                  }}               
                />
            </Panel>

            {/* Handle must be styled or it is 0px width */}
            <PanelResizeHandle style={{ width: '1px', background: '#e0e0e0' }} />

            {/* === CONTEXT PANEL (DashboardPage + Outlet) === */}
            <Panel defaultSize={80}>
              <Outlet />
            </Panel>
        </PanelGroup>
    );
}