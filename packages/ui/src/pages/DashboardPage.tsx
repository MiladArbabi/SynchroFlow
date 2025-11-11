/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-object-type */
/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/pages/DashboardPage.tsx
import React, { useState, useCallback, useEffect } from 'react';
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
  Alert
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
        icon: 'BarChart3'
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

export const DashboardPage = ({ 
  children, handleSidenavToggle }: { 
    children: React.ReactNode; handleSidenavToggle: () => void }) => {
  const [layout, setLayout] = useState(() => buildLayoutFromWidgets(initialActiveWidgets));
  const [activeWidgets, setActiveWidgets] = useState(initialActiveWidgets);

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
 const { hasIntegrations, isLoading: isIntegrationLoading, refreshIntegrationStatus } = useIntegration(); // 3. Get state from our "brain"
 const { accessToken } = useAuth();
 const queryClient = useQueryClient();

 // State for our modals
 const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
 const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
 const [connectionError, setConnectionError] = useState<string | null>(null);

 useEffect(() => {
   const connectStatus = searchParams.get('connect');
   const errorMessage = searchParams.get('message');

   if (connectStatus === 'success') {
     // 1. We're back from Shopify successfully!
     // 2. Refresh the integration state (this starts the polling)
     refreshIntegrationStatus();
     // 3. Open the "Syncing" modal
     setIsSyncModalOpen(true);
     // 4. Clean the URL
     setSearchParams({}, { replace: true });
   } else if (connectStatus === 'error') {
     // 1. Something went wrong during OAuth
     setConnectionError(errorMessage || 'An unknown connection error occurred.');
     // 2. Clean the URL
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
      setConnectionError(`System check failed: ${issues.join(' ')}`);
    }
  };

 const handleRetry = () => {
   setConnectionError(null); // Close the error modal
   handleOpenConnectModal(); // Open the connect modal
 };

 // --- [START] Conditional Banner ---
  // While the integration state is loading, show nothing
  if (isIntegrationLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

 // 3. Create the "Aha! Refresh" handler
  const handleSyncModalClose = () => {
    setIsSyncModalOpen(false);

    // Ring the "doorbell" for all our data

    // a) Refresh the main dashboard data (from Issue #638)
    queryClient.invalidateQueries({ queryKey: ['dashboardPulse'] });
    queryClient.invalidateQueries({ queryKey: ['dashboardInventory'] });
    queryClient.invalidateQueries({ queryKey: ['dashboardShipments'] });

    // b) Refresh any other data, like OpsIntel
    queryClient.invalidateQueries({ queryKey: ['opsIntelSummary'] });
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

 // --- Display loading/error state for OpsIntel data ---
 if (opsIntelLoading) {
  // Or return a more integrated loading state within the GridLayout
  return (
   <Box
    sx={{
     display: 'flex',
     justifyContent: 'center',
     alignItems: 'center',
     height: '100vh'
    }}
   >
    <CircularProgress />
   </Box>
  );
 }
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
      {!hasIntegrations && <ConnectStoreBanner onOpenModal={handleOpenConnectModal} />}
      <ConnectStoreModal
         isOpen={isConnectModalOpen}
         onClose={() => setIsConnectModalOpen(false)}
       />
       {/* 2. Replace the Alert with our new modal */}
       <ConnectionErrorModal
         open={!!connectionError}
         error={connectionError}
         onClose={() => setConnectionError(null)} // "Skip for Now"
         onRetry={handleRetry} // "Try Again"
       />
      <DataSyncingModal 
        open={isSyncModalOpen} 
        onClose={handleSyncModalClose} />
      
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