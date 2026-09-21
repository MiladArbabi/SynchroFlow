import type { ReactNode } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  Typography,
} from '@mui/material';

export interface DecisionConfirmationModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'default' | 'destructive';
  isPending?: boolean;
  confirmDisabled?: boolean;
}

export function DecisionConfirmationModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  isPending = false,
  confirmDisabled = false,
}: DecisionConfirmationModalProps) {
  const handleClose = () => {
    if (isPending) return;
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullWidth
      maxWidth="xs"
      PaperProps={{
        sx: {
          bgcolor: 'var(--surface)',
          border: '1px solid var(--rule)',
          borderRadius: '14px',
          backgroundImage: 'none',
        },
      }}
    >
      <Box
        sx={{
          px: 2.5,
          pt: 2.25,
          pb: 1.75,
          bgcolor: 'var(--bg-3)',
          borderBottom: '1px solid var(--rule)',
        }}
      >
        <Typography
          sx={{
            fontSize: 16,
            fontWeight: 500,
            color: 'var(--ink)',
            lineHeight: 1.25,
          }}
        >
          {title}
        </Typography>
      </Box>

      <DialogContent sx={{ p: 2.5 }}>
        {description && (
          <Typography
            sx={{
              fontSize: 13,
              fontWeight: 300,
              color: 'var(--ink-3)',
              lineHeight: 1.5,
            }}
          >
            {description}
          </Typography>
        )}
      </DialogContent>

      <Box
        sx={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 1,
          px: 2.5,
          py: 1.75,
          bgcolor: 'var(--bg-3)',
          borderTop: '1px solid var(--rule)',
        }}
      >
        <Button
          size="small"
          autoFocus
          onClick={handleClose}
          disabled={isPending}
          sx={{ textTransform: 'none' }}
        >
          {cancelLabel}
        </Button>

        <Button
          size="small"
          variant="contained"
          color={tone === 'destructive' ? 'error' : 'primary'}
          data-tone={tone}
          disabled={isPending || confirmDisabled}
          onClick={() => void onConfirm()}
          sx={{ textTransform: 'none' }}
        >
          {isPending ? `${confirmLabel}…` : confirmLabel}
        </Button>
      </Box>
    </Dialog>
  );
}
