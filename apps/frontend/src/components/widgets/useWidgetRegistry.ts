/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/components/widgets/useWidgetRegistry.ts
import { useMemo } from 'react';
import { useDashboardState } from '../../contexts/DashboardStateContext'; 
import { useAuth } from '../../contexts/AuthContext';
import { getWidgetsForUser, UserWidgetConfig } from './widget-registry';
import { useEntitlements } from 'contexts/EntitlementsContext';

export function useWidgetRegistry() {
  const { userState, currentView, isLoading: dashboardLoading, error } = useDashboardState();
  const { user: authUser } = useAuth();
  const { hasModule, hasFlag, isLoading: entitlementsLoading } = useEntitlements();

  const userConfig: UserWidgetConfig | null = useMemo(() => {
    if (!userState?.user) {
      return null;
    }

    return {
      detected_mode: userState.user.detected_mode,
      plan: (authUser as any)?.plan || 'free', // TODO: Add plan to PublicUser type
    };
  }, [userState, authUser]);

  const widgets = useMemo(() => {
    if (!userConfig) {
      return [];
    }

    // Pass entitlement helpers so registry can enforce gating
    return getWidgetsForUser(userConfig, {
      hasModule,
      hasFlag,
    });
  }, [userConfig, hasModule, hasFlag]);

  return {
    widgets,
    isLoading: dashboardLoading || entitlementsLoading,
    error,
  };
}
