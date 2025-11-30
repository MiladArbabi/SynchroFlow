//apps/frontend/src/components/ToastContainer.tsx
import React from 'react';
import { Box, Alert, AlertTitle } from '@mui/material';
import { AnimatePresence, motion } from 'framer-motion';
import { useToast } from 'contexts/ToastContext';

// This is the UI component our test was mocking.
export const ToastContainer = () => {
  const { state } = useToast();

  const getTitle = (type: string) => {
    switch (type) {
      case 'error':
        return 'Error';
      case 'success':
        return 'Success';
      default:
        return 'Info';
    }
  };

  return (
    <Box
      sx={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
      data-testid="container" // Added for the test
    >
      <AnimatePresence>
        {state.toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 100 }}
            transition={{ duration: 0.3 }}
          >
            <Alert
              severity={toast.type}
              sx={{ minWidth: 280, boxShadow: 6 }}
            >
              <AlertTitle>{getTitle(toast.type)}</AlertTitle>
              {toast.message}
            </Alert>
          </motion.div>
        ))}
      </AnimatePresence>
    </Box>
  );
};