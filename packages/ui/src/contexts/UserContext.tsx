// packages/ui/src/contexts/UserContext.tsx
import React, { createContext, useContext, ReactNode } from 'react';

// Define the shape of the context data
interface UserContextType {
  isSandbox: boolean;
  // We can add more user data here later, like name, email, etc.
}

// Create the context with a default value
const UserContext = createContext<UserContextType | undefined>(undefined);

interface UserProviderProps {
  children: ReactNode;
  value?: Partial<UserContextType>; // Allow overriding the value for tests
}

// Create a provider component
export const UserProvider: React.FC<UserProviderProps> = ({ children, value: overrideValue }) => {
  // For now, we'll hardcode the value to simulate being in sandbox mode.
  // Later, this will come from an API call.
  const defaultValue = { isSandbox: true };
  const value = { ...defaultValue, ...overrideValue };

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
};

// Create a custom hook to easily use the context
// eslint-disable-next-line react-refresh/only-export-components
export const useUser = (): UserContextType => {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
};