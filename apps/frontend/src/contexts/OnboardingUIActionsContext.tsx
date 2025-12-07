/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/contexts/OnboardingUIActionsContext.tsx
import React, { createContext, useContext } from 'react';

export interface OnboardingUIActions {
  openModal: (id: string) => void;
  navigate: (path: string) => void;
}

export const OnboardingUIActionsContext =
  createContext<OnboardingUIActions | null>(null);

export const useOnboardingUIActions = () => {
  return useContext(OnboardingUIActionsContext);
};
