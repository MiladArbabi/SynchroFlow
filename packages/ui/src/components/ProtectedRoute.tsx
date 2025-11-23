// packages/ui/src/components/ProtectedRoute.tsx
import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from 'contexts/AuthContext';
import { Box, CircularProgress } from '@mui/material';

/**
 * A component to protect routes from unauthenticated access.
 * It checks the authentication state from AuthContext.
 */
const ProtectedRoute: React.FC = () => {
  const { isLoggedIn, isLoading } = useAuth();

  console.log('🛡️ DEBUG ProtectedRoute - RENDERED');
  console.log('🔐 Auth state - isLoggedIn:', isLoggedIn, 'isLoading:', isLoading);
  console.log('📍 Current path:', window.location.pathname);

  // 1. Show a full-screen loader while auth status is being checked
  if (isLoading) {
    return (
      <Box 
        sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          height: '100vh' 
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  // 2. If authenticated, render the child routes (the app)
  if (isLoggedIn) {
    return <Outlet />; // Renders the nested routes (e.g., LayoutManager)
  }

  // 3. If not authenticated, redirect to the login page
  return <Navigate to="/login" replace />;
};

export default ProtectedRoute;