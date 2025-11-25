/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
// packages/ui/src/components/CostStatusIndicator.tsx
import React from 'react';
import { Chip, IconButton, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import WarningIcon from '@mui/icons-material/Warning';

interface CostStatusIndicatorProps {
  product: any;
  onClick: () => void;
}

export const CostStatusIndicator: React.FC<CostStatusIndicatorProps> = ({
  product,
  onClick
}) => {
  // TODO: Replace with actual cost data from API
  const hasCosts = false; // Placeholder - will be replaced with real data
  const margin = 42.5; // Placeholder - will be calculated from real data

  if (!hasCosts) {
    return (
      <Tooltip title="Add cost data to see profit margins" arrow>
        <IconButton 
          size="small" 
          onClick={onClick}
          color="primary"
          sx={{ 
            border: '1px dashed',
            borderColor: 'primary.main',
            borderRadius: 1,
            width: 32,
            height: 32
          }}
        >
          <AddIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    );
  }

  const getMarginColor = (margin: number) => {
    if (margin >= 40) return 'success';
    if (margin >= 20) return 'warning';
    return 'error';
  };

  const getMarginIcon = (margin: number) => {
    if (margin >= 40) return <TrendingUpIcon fontSize="small" />;
    if (margin >= 20) return null;
    return <WarningIcon fontSize="small" />;
  };

  return (
    <Tooltip title={`Click to edit costs - Current margin: ${margin}%`} arrow>
      <Chip
        label={`${margin}%`}
        size="small"
        color={getMarginColor(margin)}
        onClick={onClick}
        variant="outlined"
        icon={getMarginIcon(margin)}
        sx={{ 
          cursor: 'pointer',
          minWidth: 60,
          '&:hover': {
            backgroundColor: 'action.hover'
          }
        }}
      />
    </Tooltip>
  );
};
