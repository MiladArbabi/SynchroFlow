import { useContext } from 'react';
import { RuntimeRoutesContext } from './RuntimeRoutes.context';

export function useRuntimeRoutes() {
  const ctx = useContext(RuntimeRoutesContext);
  if (!ctx) {
    throw new Error('useRuntimeRoutes must be used inside RuntimeRoutesProvider');
  }
  return ctx;
}