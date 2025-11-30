//apps/frontend/src/components/OpsCommandCenter/InterpretationBanner.tsx
import React from 'react';
import { Box, Typography, Button, IconButton } from '@mui/material';
import { LucideTarget, LucideX } from 'lucide-react';
import { OpsAction } from 'components/OpsCommandCenter/types';
import { Intent } from './naturalLanguage/types';

// Define the component's props
interface Interpretation {
  originalQuery: string;
  interpretedAction: OpsAction | null;
  intent: Intent;
  confidence: number;
}

interface InterpretationBannerProps {
  interpretation: Interpretation;
  onExecute: () => void;
  onCancel: () => void;
}

/**
 * The UI banner that shows what Kore "understood" from a natural
 * language query (Layer 2) and asks for confirmation to execute.
 */
export const InterpretationBanner: React.FC<InterpretationBannerProps> = ({
  interpretation,
  onExecute,
  onCancel,
}) => {
  if (!interpretation.interpretedAction) {
    return null; // Should not happen if we're in this state
  }

  return (
    <Box
      sx={{
        p: 1.5,
        borderBottom: '1px solid',
        borderColor: 'divider',
        backgroundColor: 'action.hover', // A slight background tint
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
      }}
    >
      <LucideTarget size={20} color="green" />
      <Box sx={{ flexGrow: 1 }}>
        <Typography variant="body1" fontWeight="medium">
          Understood:
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {interpretation.interpretedAction.name}
        </Typography>
      </Box>

      {/* Action Buttons */}
      <Button
        variant="contained"
        color="primary"
        size="small"
        onClick={onExecute}
      >
        Execute
      </Button>
      <IconButton
        size="small"
        onClick={onCancel}
        aria-label="Cancel"
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
        }}
      >
        <LucideX size={16} />
      </IconButton>
    </Box>
  );
};