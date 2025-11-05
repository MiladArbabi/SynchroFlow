/* eslint-disable @typescript-eslint/no-explicit-any */
//packages/ui/src/contexts/HealthContext.tsx
/* eslint-disable react-refresh/only-export-components */
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from 'react';
import axios from 'axios';

// --- TYPES ---

export interface HealthContextState {
  isKoreHealthy: boolean;
}

// --- INITIAL STATE & CONTEXT ---

const initialState: HealthContextState = {
  isKoreHealthy: true, // Assume healthy by default
};

const HealthContext = createContext<HealthContextState>(initialState);

// --- PROVIDER ---

export const HealthProvider = ({ children }: { children: ReactNode }) => {
  const [isKoreHealthy, setIsKoreHealthy] = useState(true);

  useEffect(() => {
    // 1. Create an AbortController
    const controller = new AbortController();

    const healthCheck = async () => {
      try {
        // 2. Pass the signal to the axios request
        await axios.get('/api/v1/kore/health', { signal: controller.signal });

        if (!isKoreHealthy) {
          console.log('[Kore Health] Service has recovered. Re-enabling L2+ features.');
          setIsKoreHealthy(true);
        }
      } catch (error: any) {
        // Don't log an error if we're just aborting
        if (error.name === 'CanceledError') {
          return;
        }

        if (isKoreHealthy) {
          console.warn(
            '[Kore Health] Service is unhealthy. Degrading to L1-only search.',
          );
          setIsKoreHealthy(false);
        }
      }
    };

    // Check health immediately on load
    healthCheck();
    
    // Then, check every 30 seconds
    const interval = setInterval(healthCheck, 30000);

    // Clean up on unmount
    return () => {
      clearInterval(interval);
      controller.abort(); // 3. Abort any in-flight requests
    };
  }, [isKoreHealthy]); // Re-run if state changes

  return (
    <HealthContext.Provider value={{ isKoreHealthy }}>
      {children}
    </HealthContext.Provider>
  );
};

// --- HOOK ---

export const useHealthContext = () => {
  const context = useContext(HealthContext);
  if (context === undefined) {
    throw new Error('useHealthContext must be used within a HealthProvider');
  }
  return context;
};