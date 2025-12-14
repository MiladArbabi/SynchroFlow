import { createContext } from 'react';

export type RuntimeRoutesContextType = {
  version: number;
  bump: () => void;
};

export const RuntimeRoutesContext =
  createContext<RuntimeRoutesContextType | null>(null);
