/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-object-type */
/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/pages/DashboardPage.tsx
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import RGL, { WidthProvider } from 'react-grid-layout';
import axios from 'axios';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import IconComponent from 'components/Icon';
import WidgetLibrary from 'components/WidgetLibrary';
import { PlanLevel, WIDGET_REGISTRY, getWidgetConfigByVariantId } from '../widgets/widgetRegistry';
import {
  IconButton,
  Box,
  CircularProgress,
  Alert,
  Skeleton
} from '@mui/material';
import { InventoryHealthRow } from 'widgets/InventoryHealthWidget'; 
import { useLayoutContext } from '../App'; 

import { DataSyncingModal } from 'components/DataSyncingModal';
import { ConnectStoreModal } from 'components/ConnectStoreModal';
import { ConnectStoreBanner } from 'components/ConnectStoreBanner';
import { ConnectionErrorModal } from 'components/ConnectionErrorModal';
import { useIntegration } from 'contexts/IntegrationContext';
import { useAuth } from 'contexts/AuthContext';

const GridLayout = WidthProvider(RGL);

// --- OpsIntelData type ---
interface OpsIntelData {
  automated_tasks: number;
  labor_cost_saved: number;
}

// Defines the API response structure (matching the backend service)
interface OpsIntelSummaryResponse extends OpsIntelData {}

// Mock data for the InventoryHealthTable component
const mockInventoryHealthData: InventoryHealthRow[] = [
  { sku: 'SF-TS-BLK-M', quantity_available: 150, status: 'Healthy' },
  { sku: 'SF-HD-GRY-L', quantity_available: 25, status: 'At Risk' },
  { sku: 'SF-CP-NAV-OS', quantity_available: 0, status: 'Stockout' },
  { sku: 'SF-TS-WHT-S', quantity_available: 80, status: 'Healthy' }
];

// Defines the widgets that are active on the dashboard by default
const initialActiveWidgets = [
  { instanceId: 'kpi-revenue-1', variantId: 'kpi-revenue' },
  { instanceId: 'kpi-margin-1', variantId: 'kpi-margin' },
  { instanceId: 'kpi-inventory-1', variantId: 'kpi-inventory' },
  { instanceId: 'a-opex-gauge-1', variantId: 'a-opex-gauge' },
  { instanceId: 'cashflow-chart-1', variantId: 'cashflow-chart-large' },
  { instanceId: 'inventory-health-1', variantId: 'inventory-health-table' }
];

// Helper to build layout from registry, using hardcoded positions for v1
const buildLayoutFromWidgets = (widgets: typeof initialActiveWidgets): RGL.Layout[] => {
  // In a real app, x/y would come from the DB. Here we hardcode them.
  const positions: Record<string, { x: number; y: number }> = {
    'kpi-revenue-1': { x: 0, y: 0 },
    'kpi-margin-1': { x: 3, y: 0 },
    'kpi-inventory-1': { x: 6, y: 0 },
    'a-opex-gauge-1': { x: 9, y: 0 },
    'cashflow-chart-1': { x: 0, y: 1 },
    'inventory-health-1': { x: 0, y: 5 }, // Adjusted 'y' to fit cashflow
  };

  return widgets.map(({ instanceId, variantId }) => {
    const config = getWidgetConfigByVariantId(variantId);
    const pos = positions[instanceId] || { x: 0, y: 0 };
    const layout = config?.variant || { w: 3, h: 1, isResizable: false }; // Fallback

    return {
      i: instanceId,
      x: pos.x,
      y: pos.y,
      w: layout.w,
      h: layout.h,
      isResizable: layout.isResizable,
    };
  });
};

const getWidgetProps = (
  variantId: string,
  opsIntelData: OpsIntelData | undefined
) => {
  switch (variantId) {
    case 'kpi-revenue':
      return {
        title: 'Gross Revenue',
        value: '$750,930',
        percentage: '55%',
        icon: 'Store' 
      };
    case 'kpi-margin':
      return {
        title: 'Gross Margin',
        value: '$320,400',
        percentage: '12%',
        icon: 'Store'
      };
    case 'kpi-inventory':
      return {
        title: 'Inventory Value',
        value: '$1.2M',
        percentage: '-2%',
        icon: 'Package'
      };
    case 'a-opex-gauge':
      return {
        title: 'Opex Saved',
        value: opsIntelData?.labor_cost_saved ?? 0,
        target: 10000 // Hardcode target for v1
      };
    case 'cashflow-chart-large':
      return {};
    case 'inventory-health-table':
      return { data: mockInventoryHealthData };
    default:
      return {};
  }
};

// 2. Create the "Smart Empty State" (Skeleton) component
const DashboardSkeleton = ({ layout, showBanner = false }: { layout: RGL.Layout[]; showBanner?: boolean }) => {
  return (
    <>
      {showBanner && (
        <Box sx={{ p: 2, mb: 2 }}>
          <Skeleton variant="rectangular" height={80} sx={{ borderRadius: 1 }} />
        </Box>
      )}
      <GridLayout
        layout={layout}
        cols={12}
        rowHeight={120}
        compactType={null}
        preventCollision={true}
        isDraggable={false}
        isResizable={false}
      >
        {layout.map((item) => (
          <div key={item.i} style={{ width: '100%', height: '100%' }}>
            <Skeleton variant="rectangular" width="100%" height="100%" sx={{ borderRadius: 1 }} />
          </div>
        ))}
      </GridLayout>
    </>
  );
};

export const DashboardPage = ({ 
  children, handleSidenavToggle }: { 
    children: React.ReactNode; handleSidenavToggle: () => void }) => {
    const [layout, setLayout] = useState(() => buildLayoutFromWidgets(initialActiveWidgets));
    const [activeWidgets, setActiveWidgets] = useState(initialActiveWidgets);

    const instanceId = useRef(Math.random().toString(36).substr(2, 9));
    console.log(`[DashboardPage] RENDERED with instanceId: ${instanceId.current}`);

  const fetchOpsIntel = async (): Promise<OpsIntelSummaryResponse> => {
    const { data } = await axios.get<OpsIntelSummaryResponse>(
      '/api/v1/ops-intel/summary'
    );
    return data;
  };

  const {
    data: opsIntelData,
    isLoading: opsIntelLoading,
    isError: opsIntelIsError,
    error: opsIntelError
  } = useQuery<OpsIntelSummaryResponse, Error>({
    queryKey: ['opsIntelSummary'],
    queryFn: fetchOpsIntel
  });

  // Get editing state and library controls from parent context
  const {
    isEditing,
    isLibraryOpen,
    setIsLibraryOpen,
    currentUserPlan,
    layoutRef, // Get refs from context
    activeWidgetsRef // Get refs from context
  } = useLayoutContext();

  // Callback to update the layout state when the user makes changes
  const onLayoutChange = useCallback(
    (newLayout: RGL.Layout[]) => {
      if (isEditing) {
        setLayout(newLayout);
      }
    },
    [isEditing]
  );

  // --- AHA-FLOW: Handle Redirect & Modals ---
 const [searchParams, setSearchParams] = useSearchParams();
 const { 
    hasIntegrations, 
    isLoading: isIntegrationLoading, 
    isFirstTimeSync, 
    syncStatus, 
    refreshIntegrationStatus,
    lastError
  } = useIntegration();
 const { accessToken } = useAuth();
 const queryClient = useQueryClient();

 // State for our modals
 const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
 const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
 const [connectionError, setConnectionError] = useState<string | null>(null);

 useEffect(() => {
    console.log('[DashboardPage] IntegrationContext lastError:', lastError);
  }, [lastError]);

 useEffect(() => {
  console.log('[DashboardPage] connectionError STATE CHANGED to:', connectionError);
  }, [connectionError]);

  const setConnectionErrorWithLog = useCallback((newError: React.SetStateAction<string | null>) => {
  console.log('[DashboardPage] setConnectionError CALLED with:', newError);
  console.trace('[DashboardPage] setConnectionError stack trace');
  setConnectionError(newError);
}, []); 

  const handleErrorModalClose = React.useCallback(() => {
  console.log('[DashboardPage handleErrorModalClose] Firing', new Date().toISOString());
  setConnectionErrorWithLog(null); 
  setSearchParams({}, { replace: true });
}, [setConnectionErrorWithLog, setSearchParams]);

 useEffect(() => {
  const connectStatus = searchParams.get('connect');
  const errorMessage = searchParams.get('message');

  console.log(`[DashboardPage useEffect] Running. connectStatus: ${connectStatus}, current URL: ${window.location.href}`);

  // Use functional update to get the current connectionError state
  if (connectStatus === 'success') {
    console.log('[DashboardPage useEffect] Handling connect=success');
    refreshIntegrationStatus();
    setIsSyncModalOpen(true);
    setSearchParams({}, { replace: true });

  } else if (connectStatus === 'error') {
      // Check current connectionError state using functional update
      setConnectionErrorWithLog(currentError => {
      if (!currentError) {
        console.log('[DashboardPage useEffect] Setting error from URL params');
        return errorMessage || 'An unknown connection error occurred.';
      }
      return currentError;
    });
    setSearchParams({}, { replace: true });
  }
}, [searchParams, setSearchParams, refreshIntegrationStatus]); 

 const handleOpenConnectModal = async () => {
    // 5. Implement the Pre-flight Check
    try {
      // Use the accessToken from AuthContext for the protected endpoint
      await axios.get('/api/v1/integrations/pre-flight', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      
      // All systems go! Open the modal.
      setIsConnectModalOpen(true);

    } catch (err: any) {
      // Pre-flight check failed! Show the error modal.
      const issues = err.response?.data?.issues || ['An unknown server error occurred.'];
      setConnectionErrorWithLog(`System check failed: ${issues.join(' ')}`);
      //setConnectionError(`System check failed: ${issues.join(' ')}`);
    }
  };

 const handleRetry = () => {
  setConnectionErrorWithLog(null); // Use the logged version here too
  setSearchParams({}, { replace: true });
  handleOpenConnectModal();
};

useEffect(() => {
  console.log('[DashboardPage] IntegrationContext syncStatus:', syncStatus);
  console.log('[DashboardPage] IntegrationContext lastError:', lastError);
  console.log('[DashboardPage] IntegrationContext hasIntegrations:', hasIntegrations);
  console.log('[DashboardPage] IntegrationContext isFirstTimeSync:', isFirstTimeSync);
}, [syncStatus, lastError, hasIntegrations, isFirstTimeSync]);

  useEffect(() => {
    console.log(`[DashboardPage] COMPONENT MOUNTED with instanceId: ${instanceId.current}`);
    return () => {
      console.log(`[DashboardPage] COMPONENT UNMOUNTING with instanceId: ${instanceId.current}`);
    };
  }, []);

  useEffect(() => {
    console.log('[DashboardPage] COMPONENT MOUNTED/RE-RENDERED');
    return () => {
      console.log('[DashboardPage] COMPONENT UNMOUNTING');
    };
  }, []);

  // --- [START] Smart Rendering Logic ---
  // Check for modal flows first - modals take precedence over loading states
 if (isSyncModalOpen || connectionError || isConnectModalOpen) {
   // Render modals in main return - don't return early
 } 
 // Initial integration loading (replace CircularProgress with Skeleton)
 else if (isIntegrationLoading) {
   return <DashboardSkeleton layout={layout} />;
 }
 // Data refresh loading (AHA-flow and returning users)
 else if ((isFirstTimeSync && syncStatus === 'COMPLETED' && opsIntelLoading) || 
          (hasIntegrations && !isFirstTimeSync && opsIntelLoading)) {
   return <DashboardSkeleton layout={layout} />;
 }

 // 3. Create the "Aha! Refresh" handler
  const handleSyncModalClose = (error: string | null = null) => {
    setIsSyncModalOpen(false);

    if (error) {
      // If the modal passed an error, show the error modal
      setConnectionErrorWithLog(error);
    } else {
      // No error, run the "Aha! Refresh"
      // a) Stagger the invalidations for a smooth "roll in" effect
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['dashboardPulse'] });
        queryClient.invalidateQueries({ queryKey: ['opsIntelSummary'] });
      }, 100); // KPIs and OpsIntel first
  
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['dashboardInventory'] });
      }, 300); // Inventory second

      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['dashboardShipments'] });
      }, 500); // Shipments last
    }
  };

  // Handler for adding a new widget from the library
 const handleAddWidget = (variantId: string) => {
  const config = getWidgetConfigByVariantId(variantId);
  if (!config) {
      console.error(`No widget config found for variantId: ${variantId}`);
      return;
    }

  const newInstanceId = `${variantId}-${Date.now()}`;

  setActiveWidgets((prev) => [
   ...prev,
   { instanceId: newInstanceId, variantId: variantId } // Save variantId
  ]);
  setLayout((prev) => [
   ...prev,
   {
    i: newInstanceId,
    x: 0, // New widgets appear at the top-left
    y: Infinity, // Stack new widgets at the bottom
        w: config.variant.w,
        h: config.variant.h,
        isResizable: config.variant.isResizable,
    static: false
   }
  ]);
 };

  // Handler for removing a widget from the dashboard
 const handleRemoveWidget = (instanceId: string) => {
  setActiveWidgets((prev) =>
   prev.filter((w) => w.instanceId !== instanceId)
  );
  setLayout((prev) => prev.filter((l) => l.i !== instanceId));
 };

 // 6. Handle OpsIntel fetch error (after loading is complete)
  if (opsIntelIsError) {
    // Or display the error more gracefully within the dashboard layout
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">
          Failed to load dashboard data: {opsIntelError?.message}
        </Alert>
      </Box>
    );
 }

  return (
    <>
    {/* --- AHA-FLOW: Render Modals --- */}
    {/* 6. Conditionally render the banner */}
      {!hasIntegrations && 
      <ConnectStoreBanner 
        onOpenModal={handleOpenConnectModal} 
        data-testid="connect-store-button" 
      />}
      <ConnectStoreModal
         isOpen={isConnectModalOpen}
         onClose={() => setIsConnectModalOpen(false)}
       />
       {/* Connection Error Modal */}
       <ConnectionErrorModal
         open={!!connectionError}
         error={connectionError}
         onClose={handleErrorModalClose}
         onRetry={handleRetry} // "Try Again"
       />
      <DataSyncingModal 
        open={isSyncModalOpen} 
        onClose={handleSyncModalClose} 
        data-testid="data-syncing-modal"
      />
      
      <GridLayout
        layout={layout}
        cols={12}
        rowHeight={120}
        compactType={null}
        preventCollision={true}
        isDraggable={isEditing}
        isResizable={isEditing}
        onLayoutChange={onLayoutChange}
        // Add a class for styling the grid items in edit mode
        className={isEditing ? 'grid-editing grid-wiggling' : ''}
      >
        {activeWidgets.map(({ instanceId, variantId }) => {
          const config = getWidgetConfigByVariantId(variantId);
            if (!config) {
            console.warn(
              `Widget config for variantId "${variantId}" not found.`
            );
            return <div key={instanceId}>Error: Widget not found</div>; // Render fallback
          }
          const WidgetComponent = config.parentConfig.component;

          return (
            <div
              key={instanceId}
              style={{ width: '100%', height: '100%', position: 'relative' }}
            >
              {/* Pass the data fetched by useQuery */}
              <WidgetComponent {...getWidgetProps(variantId, opsIntelData)} />
              {isEditing && (
                <IconButton
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => handleRemoveWidget(instanceId)}
                  size="small"
                  sx={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    backgroundColor: 'rgba(255, 255, 255, 0.7)',
                    '&:hover': { backgroundColor: 'white' },
                    zIndex: 10
                  }}
                >
                  <IconComponent name="X" size="xs" color="inherit" />
                </IconButton>
              )}
            </div>
          );
        })}
      </GridLayout>
      <WidgetLibrary
        open={isLibraryOpen}
        onClose={() => setIsLibraryOpen(false)}
        onAddWidget={handleAddWidget}
        currentPlan={currentUserPlan}
      />
    </>
  );
};