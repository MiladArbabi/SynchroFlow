// packages/ui/src/Layout.tsx
import { useState, useEffect } from "react";
import { useLocation, Outlet } from "react-router-dom";
import Sidenav from './layouts/AppLayout/SidenavContent'
import { DashboardPage } from "pages/DashboardPage";
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

    const handleSidenavToggle = () => setSidenavOpen(!isSidenavOpen);

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
                  isSidenavOpen={isSidenavOpen} isConnected={false} onOpenModal={function (): void {
                    throw new Error("Function not implemented.");
                  } }                
                />
            </Panel>

            {/* Handle must be styled or it is 0px width */}
            <PanelResizeHandle style={{ width: '1px', background: '#e0e0e0' }} />

            {/* === CONTEXT PANEL (DashboardPage + Outlet) === */}
            <Panel
              defaultSize={80}
              role="group" // For the test
            >
                <DashboardPage handleSidenavToggle={handleSidenavToggle}>
                    <Outlet /> {/* This will render the active page */}
                </DashboardPage>
            </Panel>
        </PanelGroup>
    );
}