// apps/frontend/src/runtime/RuntimeRoutesProvider.tsx
import React, { useState } from 'react';
import { RuntimeRoutesContext } from './RuntimeRoutes.context';

export const RuntimeRoutesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [version, setVersion] = useState(0);

  const bump = () => setVersion(v => v + 1);

  return (
    <RuntimeRoutesContext.Provider value={{ version, bump }}>
      {children}
    </RuntimeRoutesContext.Provider>
  );
};