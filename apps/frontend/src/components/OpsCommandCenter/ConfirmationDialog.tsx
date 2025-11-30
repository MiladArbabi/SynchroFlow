//apps/frontend/src/components/OpsCommandCenter/ConfirmationDialog.tsx
import React from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
  Alert,
} from '@mui/material';
import { OpsAction } from './types';
import { LucideAlertTriangle } from 'lucide-react';

interface ConfirmationDialogProps {
  isOpen: boolean;
  action: OpsAction | null; // Action to be confirmed
  onConfirm: () => void;
  onCancel: () => void;
  // We'll add previewData in a future ticket
  // previewData?: any; 
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  isOpen,
  action,
  onConfirm,
  onCancel,
}) => {
  // Don't render anything if the dialog is closed or no action is provided
  if (!isOpen || !action) {
    return null;
  }

  // Get the confirmation message. We'll enhance this later to support functions.
  // Resolve the confirmation message.
  let message: React.ReactNode;
  if (typeof action.confirmationMessage === 'function') {
    // In the future, we'll pass previewData here. For now, pass null.
    message = action.confirmationMessage(null);
  } else {
    message =
      action.confirmationMessage ||
      `Are you sure you want to execute "${action.name}"?`;
  }

  return (
    <Dialog open={isOpen} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          fontWeight: 'medium',
        }}
      >
        <LucideAlertTriangle color="orange" />
        Confirm: {action.name}
      </DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          This action may be destructive or irreversible.
        </Alert>
        <Typography variant="body1">{message}</Typography>
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button variant="outlined" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="warning" // Destructive actions are "warning"
          onClick={onConfirm}
          autoFocus
        >
          Confirm
        </Button>
      </DialogActions>
    </Dialog>
  );
};