//packages/ui/src/layouts/AppLayout/index.tsx
import React, { ReactNode } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import MDBox from "../../components/MDBox";
import SidenavContent from "./SidenavContent";
import TopnavbarContent from "./TopnavbarContent";

// Define simple styles for the handles for now. We will improve these later.
const handleStyle = {
  width: "4px",
  background: "#e0e0e0",
};

const verticalHandleStyle = {
  height: "4px",
  background: "#e0e0e0",
};

interface AppLayoutProps {
  children: ReactNode;
}

const AppLayout = ({ children }: AppLayoutProps) => {
  return (
    <MDBox sx={{ width: "100vw", height: "100vh" }}>
      <PanelGroup direction="horizontal">
        {/* Sidenav Panel */}
        <Panel defaultSize={20} minSize={5} maxSize={25} collapsible>
          <MDBox sx={{ height: "100%", borderRight: "1px solid #e0e0e0" }}>
            <SidenavContent />
          </MDBox>
        </Panel>
        <PanelResizeHandle style={handleStyle} />
        {/* Main Content Panel (contains Topnav, Workspace, and Ops Console) */}
        <Panel>
          <MDBox sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
            {/* Topnavbar Area */}
            <MDBox sx={{ height: "60px", flexShrink: 0, borderBottom: "1px solid #e0e0e0" }}>
              <TopnavbarContent isSidenavOpen={true} handleSidenavToggle={() => {}} />
            </MDBox>
          {/* Resizable area for Workspace and Ops Console */}
            <PanelGroup direction="vertical">
              {/* Workspace Panel (Outlet) */}
              <Panel defaultSize={75} minSize={50}>
                <MDBox sx={{ height: "100%", overflow: "auto", padding: "16px" }}>
                  {children}
                </MDBox>
              </Panel>
              <PanelResizeHandle style={verticalHandleStyle} />
              {/* Ops Console Panel */}
              <Panel defaultSize={25} minSize={10} collapsible>
                <MDBox sx={{ height: "100%", borderTop: "1px solid #e0e0e0" }}>
                  Ops Console Placeholder
                </MDBox>
              </Panel>
            </PanelGroup>
          </MDBox>
        </Panel>
      </PanelGroup>
    </MDBox>
  );
};

export default AppLayout;
