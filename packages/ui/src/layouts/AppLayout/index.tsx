// packages/ui/src/layouts/AppLayout/index.tsx
import React, { ReactNode, useRef, useEffect } from "react"; // Import useRef, useEffect
// --- PANEL IMPORTS ---
import { Panel, PanelGroup, PanelResizeHandle, ImperativePanelHandle } from "react-resizable-panels"; // Import ImperativePanelHandle
// --- END PANEL IMPORTS ---
import { Box } from "@mui/material";
import SidenavContent from "./SidenavContent";
import TopnavbarContent from "./TopnavbarContent";

// --- CONTEXT IMPORT ---
import useConfig from 'hooks/useConfig';
// --- END CONTEXT ---

// Define simple styles for the handles
const handleStyle = { width: "4px", background: "#e0e0e0" };
const verticalHandleStyle = { height: "4px", background: "#e0e0e0" };

// --- CONSTANTS for panel sizes ---
const SIDENAV_DEFAULT_SIZE = 16; // Percentage
const SIDENAV_MIN_SIZE = 5;      // Percentage (for collapsed state)
const SIDENAV_MAX_SIZE = 25;     // Percentage
// --- END CONSTANTS ---

interface AppLayoutProps {
  children: ReactNode;
  isEditing: boolean;
  onEditToggle: () => void;
  onAddWidget: () => void;
  // onToggleSidenav: () => void; // REMOVE this prop, toggle is now internal via context
}

const AppLayout = ({
  children,
  isEditing,
  onEditToggle,
  onAddWidget,
  // onToggleSidenav // REMOVE this prop
}: AppLayoutProps) => {

  // --- GET STATE & REF ---
  const { state } = useConfig();
  const sidenavPanelRef = useRef<ImperativePanelHandle>(null); // Ref for the Sidenav panel
  // --- END GET STATE & REF ---

  // --- EFFECT TO CONTROL PANEL ---
  useEffect(() => {
    const panel = sidenavPanelRef.current;
    if (panel) {
      const isCurrentlyCollapsed = panel.isCollapsed(); // <-- Use the correct method to check state

      if (state.miniDrawer) { // If miniDrawer is true (requesting closed/mini state)
        if (!isCurrentlyCollapsed) { // Only collapse if not already collapsed
          panel.collapse();
        }
        // Optional: Ensure size is minimal *after* collapsing
        // if(panel.getSize() > SIDENAV_MIN_SIZE) {
        //    panel.resize(SIDENAV_MIN_SIZE); // Might cause flashing, test carefully
        // }

      } else { // If miniDrawer is false (requesting open state)
        if (isCurrentlyCollapsed) { // Only expand if currently collapsed
          panel.expand();
          // Resize back to default *after* expanding ensures it opens fully
          panel.resize(SIDENAV_DEFAULT_SIZE);
        }
        // Optional: Ensure size is default even if not collapsed but maybe manually resized smaller
        else if (panel.getSize() < SIDENAV_DEFAULT_SIZE) {
             panel.resize(SIDENAV_DEFAULT_SIZE);
        }
      }
    }
  }, [state.miniDrawer]);
  // --- END EFFECT ---

  return (
    <Box sx={{ width: "100vw", height: "100vh" }}> 
      <PanelGroup direction="horizontal">
        {/* Sidenav Panel */}
        <Panel
          ref={sidenavPanelRef} // Assign the ref
          defaultSize={SIDENAV_DEFAULT_SIZE}
          minSize={SIDENAV_MIN_SIZE}
          maxSize={SIDENAV_MAX_SIZE}
          collapsible={true} // Ensure it's collapsible
          // We can optionally set collapsedSize if needed, but minSize might be sufficient
           collapsedSize={SIDENAV_MIN_SIZE} // Explicitly set collapsed size
           order={1} // Define order for layout
        >
          {/* Use overflow: hidden and flex column for content */}
          <Box sx={{ height: "100%", borderRight: "1px solid #e0e0e0", display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <SidenavContent />
          </Box>
        </Panel>
        <PanelResizeHandle style={handleStyle} />
        {/* Main Content Panel */}
        <Panel order={2}> {/* Define order */}
          <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
            {/* Topnavbar Area */}
            <Box sx={{ height: "60px", flexShrink: 0, borderBottom: "1px solid #e0e0e0" }}>
              {/* Pass necessary props, but NOT the toggle handler */}
              <TopnavbarContent
                // handleSidenavToggle={onToggleSidenav} // REMOVED
                isEditing={isEditing}
                onEditToggle={onEditToggle}
                onAddWidget={onAddWidget}
              />
            </Box>

            {/* Resizable area for Workspace and Ops Console */}
            <Box sx={{ flexGrow: 1, position: 'relative', overflow: 'hidden' }}>
              <PanelGroup direction="vertical">
                {/* Workspace Panel (Outlet) */}
                <Panel defaultSize={75} minSize={50} order={1}> {/* Define order */}
                  <Box sx={{ height: "100%", width: "100%", overflowY: "auto", position: "relative" }}>
                    {children}
                  </Box>
                </Panel>
                <PanelResizeHandle style={verticalHandleStyle} />
                {/* Ops Console Panel */}
                <Panel defaultSize={25} minSize={10} collapsible={true} order={2}> {/* Define order */}
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