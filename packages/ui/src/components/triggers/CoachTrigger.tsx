// packages/ui/src/components/triggers/CoachTrigger.tsx
import React from 'react';
import { Box, Typography, Chip, Stack } from '@mui/material';
import { BaseTrigger } from './BaseTrigger';
import { CoachTriggerProps } from './types';

/**
 * A specialized trigger for contextual coaching and guidance.
 * 
 * Explains "why" metrics matter and provides clear next steps
 * with expected impact and success metrics.
 */
export const CoachTrigger: React.FC<CoachTriggerProps> = ({
  tactic,
  successMetrics,
  estimatedImpact,
  title,
  children,
  ...baseProps
}) => {
  const getImpactVariant = (impact: string) => {
  const lowerImpact = impact.toLowerCase();
  
  // Positive indicators
  if (impact.startsWith('+') || 
      lowerImpact.includes('increase') || 
      lowerImpact.includes('improve') ||
      lowerImpact.includes('growth') ||
      // Negative metrics that are good when reduced
      (impact.startsWith('-') && (
        lowerImpact.includes('churn') ||
        lowerImpact.includes('cost') ||
        lowerImpact.includes('waste') ||
        lowerImpact.includes('loss')
      ))) {
    return 'success';
  }
  
  return 'default';
};

  return (
    <BaseTrigger {...baseProps} triggerType="coach">
      <Box data-testid="coach-trigger-content">
        {/* Coaching Header */}
        <Stack spacing={1} sx={{ mb: 2 }}>
          {title && (
            <Typography 
              variant="h6" 
              data-testid="coach-title"
              sx={{ fontWeight: 'bold' }}
            >
              {title}
            </Typography>
          )}
          
          {/* Tactic */}
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Recommended Tactic:
            </Typography>
            <Chip 
              label={tactic}
              size="small"
              color="primary"
              variant="outlined"
              data-testid="coach-tactic"
              aria-label={`Recommended tactic: ${tactic}`}
            />
          </Box>

          {/* Success Metrics */}
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Expected Impact On:
            </Typography>
            <Chip 
              label={successMetrics.join(', ')}
              size="small"
              color="secondary"
              variant="outlined"
              data-testid="coach-success-metrics"
              aria-label={`Success metrics: ${successMetrics.join(', ')}`}
            />
          </Box>

          {/* Estimated Impact */}
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Estimated Impact:
            </Typography>
            <Chip 
              label={estimatedImpact}
              size="small"
              color={getImpactVariant(estimatedImpact)}
              variant="filled"
              data-testid="coach-impact"
              aria-label={`Estimated impact: ${estimatedImpact}`}
            />
          </Box>
        </Stack>

        {/* Children Content */}
        {children}
      </Box>
    </BaseTrigger>
  );
};