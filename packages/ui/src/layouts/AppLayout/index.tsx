//packages/ui/src/layouts/AppLayout/index.tsx
import React, { ReactNode } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import MDBox from "../../components/MDBox";

// Define simple styles for the handles for now. We will improve these later.
const handleStyle = {
  width: "4px",
  background: "#e0e0e0",
};

const verticalHandleStyle = {
  height: "4px",
  background: "#e0e0e0",
};

// This layout will eventually take children to render inside the "Workspace"
interface AppLayoutProps {
  children: ReactNode;
}

const AppLayout = ({ children }: AppLayoutProps) => {
  return (
    <MDBox sx={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Topnavbar Panel */}
      <MDBox sx={{ height: "60px", flexShrink: 0, borderBottom: "1px solid #e0e0e0" }}>
        {/* We will add the real DashboardNavbar component here later */}
        Topnavbar Placeholder
      </MDBox>

      {/* Main Content Area */}
      <MDBox sx={{ flexGrow: 1, height: "calc(100vh - 60px)" }}>
        <PanelGroup direction="horizontal">
          {/* Sidenav Panel */}
          <Panel defaultSize={20} minSize={5} maxSize={25} collapsible>
            <MDBox sx={{ height: "100%", borderRight: "1px solid #e0e0e0" }}>
              {/* We will add the real Sidenav component here later */}
              Sidenav Placeholder
            </MDBox>
          </Panel>
          <PanelResizeHandle style={handleStyle} />

          {/* Vertical group for Workspace and Ops Console */}
          <Panel>
            <PanelGroup direction="vertical">
              {/* Workspace Panel (Outlet) */}
              <Panel defaultSize={75} minSize={50}>
                <MDBox sx={{ height: "100%", overflow: "auto", padding: "16px" }}>
                  {children} {/* This is where our page content will go */}
                </MDBox>
              </Panel>
              <PanelResizeHandle style={verticalHandleStyle} />
              {/* Ops Console Panel */}
              <Panel defaultSize={25} minSize={10} collapsible>
                <MDBox sx={{ height: "100%", borderTop: "1px solid #e0e0e0" }}>
                  {/* We will add the real Ops Console component here later */}
                  Ops Console Placeholder
                </MDBox>
              </Panel>
            </PanelGroup>
          </Panel>
        </PanelGroup>
      </MDBox>
    </MDBox>
  );
};

export default AppLayout;
