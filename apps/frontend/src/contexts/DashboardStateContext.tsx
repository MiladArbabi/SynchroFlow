/* eslint-disable react-refresh/only-export-components */
// apps/frontend/src/contexts/DashboardStateContext.tsx
import React, { createContext, useContext, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { useAuth } from './AuthContext';

interface UserState {
  user: {
    id: number;
    email: string;
    preferred_mode?: 'survival' | 'growth' | 'architect';
    detected_mode: 'survival' | 'growth' | 'architect';
    shopify_connected: boolean;
    stripe_connected: boolean;
    first_insight_delivered: boolean;
  };
  milestones: Array<{
    id: number;
    milestone: string;
    achieved_at: string;
  }>;
  current_mode: 'survival' | 'growth' | 'architect';
}

interface DashboardStateContextType {
  userState: UserState | null;
  isLoading: boolean;
  error: Error | null;
  refetchUserState: () => void;
  currentView: 'empty' | 'survival' | 'growth' | 'architect';
}

const DashboardStateContext = createContext<DashboardStateContextType | undefined>(undefined);

interface DashboardStateProviderProps {
  children: ReactNode;
}

export const DashboardStateProvider: React.FC<DashboardStateProviderProps> = ({ children }) => {
  const { accessToken } = useAuth();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['userState'],
    queryFn: async (): Promise<UserState> => {
      const response = await axios.get('/api/v1/user-state/state', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      return response.data;
    },
    enabled: !!accessToken,
  });

  // Determine current view based on user state
  const currentView = (() => {
    if (isLoading || !data) return 'empty';
    if (!data.user.shopify_connected) return 'empty';
    return data.current_mode;
  })();

  const value: DashboardStateContextType = {
    userState: data || null,
    isLoading,
    error,
    refetchUserState: refetch,
    currentView,
  };

  return (
    <DashboardStateContext.Provider value={value}>
      {children}
    </DashboardStateContext.Provider>
  );
};

export const useDashboardState = () => {
  const context = useContext(DashboardStateContext);
  if (context === undefined) {
    throw new Error('useDashboardState must be used within a DashboardStateProvider');
  }
  return context;
};