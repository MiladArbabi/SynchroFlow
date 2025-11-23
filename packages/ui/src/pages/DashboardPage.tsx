/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
// packages/ui/src/pages/DashboardPage.tsx
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Alert,
  Skeleton
} from '@mui/material';
import { useLayoutContext } from '../App'; 

import { DataSyncingModal } from 'components/DataSyncingModal';
import { ConnectStoreModal } from 'components/ConnectStoreModal';
import { ConnectStoreBanner } from 'components/ConnectStoreBanner';
import { ConnectionErrorModal } from 'components/ConnectionErrorModal';
import { useIntegration } from 'contexts/IntegrationContext';
import { useAuth } from 'contexts/AuthContext';
import { DashboardStateManager } from 'components/DashboardStateManager/DashboardStateManager';

import { WidgetLayoutWithRegistry } from 'components/widgets/WidgetLayoutWithRegistry';

export const DashboardPage = ({ 
  children, handleSidenavToggle }: { 
    children: React.ReactNode; handleSidenavToggle: () => void }) => {

  // --- AHA-FLOW: Handle Redirect & Modals ---
 const [searchParams, setSearchParams] = useSearchParams();
 const { 
    hasIntegrations, 
    isLoading: isIntegrationLoading, 
    isFirstTimeSync, 
    syncStatus, 
    refreshIntegrationStatus } = useIntegration();
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
    console.log('🎯 SUCCESS PATH: OAuth completed, opening sync modal');
    refreshIntegrationStatus();
    setIsSyncModalOpen(true);
    setSearchParams({}, { replace: true });
    
  } else if (connectStatus === 'error') {
    console.log('❌ ERROR PATH:', errorMessage);
    setConnectionError(errorMessage || 'An unknown connection error occurred.');
    setSearchParams({}, { replace: true });
  } else {
    console.log('ℹ️ NO CONNECT PARAM: User navigated directly to dashboard');
  }
}, []);

// Debug: Log when DashboardPage renders
 useEffect(() => {
   console.log('🏠 DEBUG DashboardPage - RENDERED', {
     pathname: window.location.pathname,
     searchParams: Object.fromEntries(searchParams.entries())
   });
 });

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

  // --- Smart Rendering Logic ---
  // Check for modal flows first - modals take precedence over loading states
 if (isSyncModalOpen || connectionError || isConnectModalOpen) {
   // Render modals in main return - don't return early
 } 


 // 3. Create the "Aha! Refresh" handler
  const handleSyncModalClose = () => {
    setIsSyncModalOpen(false);

    // Ring the "doorbell" for all our data

    // a) Refresh the main dashboard data (from Issue #638)
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
  };

  return (
    <>
    {/* --- AHA-FLOW: Render Modals --- */}
    {/* 6. Conditionally render the banner */}
       <ConnectStoreModal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
      />
      <ConnectionErrorModal
        open={!!connectionError}
        error={connectionError}
        onClose={() => setConnectionError(null)}
        onRetry={handleRetry}
      />
      <DataSyncingModal 
        open={isSyncModalOpen} 
        onClose={handleSyncModalClose} 
        data-testid="data-syncing-modal"
      />
      
      <DashboardStateManager onConnectStore={handleOpenConnectModal}>
        {/* Widget system integration */}
        <WidgetLayoutWithRegistry />
      </DashboardStateManager>
      </>
  );
};