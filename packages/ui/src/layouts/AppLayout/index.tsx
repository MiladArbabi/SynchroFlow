//packages/ui/src/layouts/AppLayout/index.tsx
import React, { ReactNode } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Box } from "@mui/material";
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
  isEditing: boolean;
  onEditToggle: () => void;
  onAddWidget: () => void;
  onToggleSidenav: () => void;
}

const AppLayout = ({
  children,
  isEditing,
  onEditToggle,
  onAddWidget,
  onToggleSidenav
}: AppLayoutProps) => {
  return (
    <Box sx={{ width: "100vw", height: "100vh" }}>
      <PanelGroup direction="horizontal">
        {/* Sidenav Panel */}
        <Panel defaultSize={20} minSize={5} maxSize={25} collapsible>
          <Box sx={{ height: "100%", borderRight: "1px solid #e0e0e0" }}>
            <SidenavContent />
          </Box>
        </Panel>
        <PanelResizeHandle style={handleStyle} />
        {/* Main Content Panel (contains Topnav, Workspace, and Ops Console) */}
        <Panel>
          <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
            {/* Topnavbar Area */}
            <Box sx={{ height: "60px", flexShrink: 0, borderBottom: "1px solid #e0e0e0" }}>
              {/* FIX: Re-add TopnavbarContent. Pass dummy props for now. */}
              <TopnavbarContent
                handleSidenavToggle={onToggleSidenav} // Use prop
                isEditing={isEditing}
                onEditToggle={onEditToggle}
                onAddWidget={onAddWidget}
              />
            </Box>

          {/* Resizable area for Workspace and Ops Console */}
          <Box sx={{ flexGrow: 1, position: 'relative', overflow: 'hidden' }}>
            <PanelGroup direction="vertical">
              {/* Workspace Panel (Outlet) */}
              <Panel defaultSize={75} minSize={50}>
                <Box sx={{ height: "100%", width: "100%", overflow: "auto", position: "relative" }}>
                  {children}
                </Box>
            </Panel>
            <PanelResizeHandle style={verticalHandleStyle} />
            {/* Ops Console Panel */}
            <Panel defaultSize={25} minSize={10} collapsible>
              <Box sx={{ height: "100%", borderTop: "1px solid #e0e0e0" }}>
                Ops Console Placeholder
              </Box>
              </Panel>
              </PanelGroup>
            </Box>
          </Box>
        </Panel>
      </PanelGroup>
    </Box>
  );
};

export default AppLayout;
