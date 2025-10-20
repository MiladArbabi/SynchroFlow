/* eslint-disable react-refresh/only-export-components */
//packages/ui/src/contexts/UserContext.tsx
import React, { createContext, useState, useContext, ReactNode } from 'react';

// Define the shape of the user and the context
interface User {
  id: string;
  name: string;
  email: string;
  shopId: number | null;
}

interface UserContextType {
  user: User | null;
  isAuthenticated: boolean;
  isSandbox: boolean;
  login: (userData: User) => void;
  logout: () => void;
}

// Create the context with a default value
const UserContext = createContext<UserContextType | undefined>(undefined);

// Create the provider component
export const UserProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);

  const login = (userData: User) => {
    setUser(userData);
    // In a real app, you would also set a token in localStorage or a cookie
  };

  const logout = () => {
    setUser(null);
    // Clear any stored tokens
  };

  const isAuthenticated = !!user;
  const isSandbox = !isAuthenticated;

  const value = {
    user,
    isAuthenticated,
    isSandbox,
    login,
    logout,
  };

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
};

// Create a custom hook for easy access to the context
export const useUser = () => {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
};