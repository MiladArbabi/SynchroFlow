// apps/frontend/src/pages/dashboard/PlatformFt1Card.tsx

/**
 * PlatformFt1Card
 *
 * FT1 diagnostic card for Platform readiness.
 *
 * Responsibilities:
 * - Render read-only diagnostic truth (title + message)
 * - Optionally render CTA if a taskId exists
 * - Emit START_ONBOARDING intent when CTA is clicked
 *
 * Non-responsibilities:
 * - No readiness fetching
 * - No navigation
 * - No checklist logic
 * - No side effects beyond intent emission
 */

import React from 'react';
import MainCard from 'ui-component/cards/MainCard';
import { Typography, Button } from '@mui/material';

export interface PlatformFt1CardProps {
  title: string;
  message: string;
  taskId?: string;
  onIntent: (intent: { type: 'START_ONBOARDING'; taskId: string }) => void;
}

export function PlatformFt1Card({
  title,
  message,
  taskId,
  onIntent,
}: PlatformFt1CardProps) {
  const handleCtaClick = () => {
    if (!taskId) return;

    if (import.meta.env.DEV) {
      console.info('[FT1][PlatformCard] START_ONBOARDING', { taskId });
    }

    onIntent({ type: 'START_ONBOARDING', taskId });
  };

  return (
    <MainCard title={title}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {message}
      </Typography>

      {taskId && (
        <Button
          variant="contained"
          size="small"
          onClick={handleCtaClick}
        >
          {message}
        </Button>
      )}
    </MainCard>
  );
}