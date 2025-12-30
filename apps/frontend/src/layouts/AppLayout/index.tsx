/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/layouts/AppLayout/index.tsx
import React, { ReactNode, useRef, useEffect, useState } from "react"; 
import { axiosInstance } from "api/axiosConfig";
// --- PANEL IMPORTS ---
import { Panel, PanelGroup, PanelResizeHandle, ImperativePanelHandle } from "react-resizable-panels"; // Import ImperativePanelHandle

import { Box } from "@mui/material";
import Sidenav from "./SidenavContent";
import TopnavbarContent from "./TopnavbarContent";
import routes from "routes";
import Customization from "layout/Customization";

// --- MODAL/BANNER IMPORTS ---
import { ConnectStoreModal } from 'components/ConnectStoreModal';

// --- CONTEXT IMPORT ---
import useConfig from 'hooks/useConfig';

import { ToastProvider } from 'contexts/ToastContext';

// Define simple styles for the handles
const handleStyle = { width: "4px", background: "#e0e0e0" };
const verticalHandleStyle = { height: "4px", background: "#e0e0e0" };

// --- CONSTANTS for panel sizes ---
const SIDENAV_DEFAULT_SIZE = 16; // Percentage
const SIDENAV_MIN_SIZE = 5;      // Percentage (for collapsed state)
const SIDENAV_MAX_SIZE = 25;     // Percentage

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
  const { state, dispatch } = useConfig();
  const sidenavPanelRef = useRef<ImperativePanelHandle>(null); // Ref for the Sidenav panel
  const opsPanelRef = useRef<ImperativePanelHandle>(null);
  const [isSidenavOpen, setSidenavOpen] = useState(true);

  // --- STATE LIFTED FROM DASHBOARD ---
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [isConnected, setIsConnected] = useState(false); 

  const isDev =
   typeof import.meta !== 'undefined' &&
   (import.meta as any).env?.DEV === true;

  // --- LOGIC LIFTED FROM DASHBOARD ---
  useEffect(() => {
    const fetchLayout = async () => {
      try {
        await axiosInstance.get('/api/v1/layouts/dashboard');
        setIsConnected(true);
      } catch {
        setIsConnected(false);
      }
    };

    fetchLayout();
  }, []);

  // --- MODAL HANDLERS LIFTED FROM DASHBOARD ---
  const handleModalClose = () => {
    setIsConnectModalOpen(false);
    // Simple reload to refresh all data.
    window.location.reload();
  };

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

  // --- GLOBAL HOTKEY LISTENER ---
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check for Cmd+J (Mac) or Ctrl+J (Windows/Linux)
      if ((event.metaKey || event.ctrlKey) && event.key === 'j') {
        event.preventDefault();
        // Dispatch the action to toggle the console
        dispatch({ type: 'TOGGLE_OPS_CONSOLE' });
      }
    };

    // Add event listener
    window.addEventListener('keydown', handleKeyDown);

    // Clean up on unmount
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [dispatch]); // Dependency array with dispatch

  // --- EFFECT TO CONTROL OPS CONSOLE PANEL ---
  useEffect(() => {
    const panel = opsPanelRef.current;
    if (panel) {
      if (state.isOpsConsoleOpen) { // <-- 4. READ FROM CONFIG STATE
        if (panel.isCollapsed()) {
          panel.expand();
          panel.resize(25); // Resize to default 25%
        }
      } else {
        if (!panel.isCollapsed()) {
          panel.collapse();
        }
      }
    }
  }, [state.isOpsConsoleOpen]); // <-- 5. DEPEND ON CONFIG STATE
  // --- END OPS CONSOLE EFFECT ---

  return (
      <ToastProvider>
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
                onCollapse={() => dispatch({ type: 'SET_MINI_DRAWER', payload: true })} // <-- 2. Sync drag-to-collapse
                onExpand={() => dispatch({ type: 'SET_MINI_DRAWER', payload: false })}   // <-- 3. Sync drag-to-expand
                collapsedSize={SIDENAV_MIN_SIZE} // Explicitly set collapsed size
                order={1} // Define order for layout
              >
                {/* Use overflow: hidden and flex column for content */}
                <Box sx={{ height: "100%", borderRight: "1px solid #e0e0e0", display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <Sidenav
                    brandName="SynchroFlow"
                    routes={routes}
                    isSidenavOpen={isSidenavOpen} // This is for the old menu
                    isConnected={isConnected} // <-- Pass connection status
                    onOpenModal={() => setIsConnectModalOpen(true)}
                  />
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
                        <Panel
                          ref={opsPanelRef} // <-- 6. ASSIGN REF
                          defaultSize={0} // <-- 7. DEFAULT TO 0 (collapsed)
                          minSize={10}
                          collapsible={true}
                          collapsedSize={0} // <-- 8. EXPLICITLY 0
                          onCollapse={() => {
                            // 9. Sync state if user manually collapses
                            if (state.isOpsConsoleOpen) {
                              dispatch({ type: 'TOGGLE_OPS_CONSOLE' });
                            }
                          }}
                          onExpand={() => {
                            // 10. Sync state if user manually expands
                            if (!state.isOpsConsoleOpen) {
                              dispatch({ type: 'TOGGLE_OPS_CONSOLE' });
                            }
                          }}
                          order={2}
                        >
                        </Panel>
                      </PanelGroup>
                    </Box>
                  </Box>
                </Panel>
              </PanelGroup>
              <Customization />

            {/* --- RENDER MODALS AT LAYOUT LEVEL --- */}
            <ConnectStoreModal
              isOpen={isConnectModalOpen}
              onClose={handleModalClose}
            />
        </Box>
      </ToastProvider>
  );
};

export default AppLayout;