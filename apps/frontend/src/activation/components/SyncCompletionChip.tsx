import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import { CheckCircle2 } from 'lucide-react';
import { ACTIVATION_COLORS, ACTIVATION_EASING } from '../activationMotionTokens';

export interface SyncCompletionChipProps {
  visible: boolean;
  reducedMotion: boolean;
  onEnterWorkspace: () => void;
}

/**
 * Non-blocking post-OAuth completion handoff.
 *
 * Replaces the old centred, screen-dimming "Sync complete" overlay. There is no
 * backdrop and no takeover — the seven-scene film stays fully visible. The chip
 * sits in an unused corner and is visually secondary. "Enter workspace" is only
 * offered once real sync is complete and completion is eligible; clicking it
 * accelerates the presentation timing (skips the remaining post-sync resolve
 * wait) without touching backend or lifecycle authority.
 */
export const SyncCompletionChip: React.FC<SyncCompletionChipProps> = ({
  visible,
  reducedMotion,
  onEnterWorkspace,
}) => {
  if (!visible) return null;

  return (
    <Box
      data-testid="sync-completion-chip"
      data-blocking="false"
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      sx={{
        position: 'fixed',
        right: { xs: 12, sm: 20 },
        bottom: { xs: 12, sm: 20 },
        zIndex: 30,
        maxWidth: 'calc(100vw - 24px)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1.25,
        pl: 1.75,
        pr: 1,
        py: 1,
        border: '1px solid rgba(76,175,122,0.38)',
        borderRadius: 1,
        bgcolor: 'var(--surface)',
        boxShadow: 'var(--shadow-md, 0 8px 24px rgba(0,0,0,0.16))',
        animation: reducedMotion
          ? 'none'
          : `activationChipRise 240ms ${ACTIVATION_EASING.exit} both`,
        '@keyframes activationChipRise': {
          '0%': { opacity: 0, transform: 'translateY(8px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
      }}
    >
      <CheckCircle2 size={18} color={ACTIVATION_COLORS.completion} aria-hidden="true" />
      <Typography
        sx={{
          color: ACTIVATION_COLORS.textSecondary,
          fontSize: 13,
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >
        Sync complete
      </Typography>
      <Button
        size="small"
        onClick={onEnterWorkspace}
        sx={{
          textTransform: 'none',
          fontSize: 13,
          fontWeight: 600,
          color: ACTIVATION_COLORS.workflowAction,
          px: 1,
          minWidth: 0,
          '&:hover': { bgcolor: 'transparent', color: ACTIVATION_COLORS.workflowActionHover },
        }}
      >
        Enter workspace
      </Button>
    </Box>
  );
};
