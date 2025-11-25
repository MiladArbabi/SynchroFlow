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
  // Check if product has cost data and calculate margin
  const hasCostData = product.purchase_price && product.landed_cost && product.selling_price;
  const margin = product.margin || (hasCostData ? 
    ((product.selling_price - product.landed_cost) / product.selling_price) * 100 : 0
  );

  if (hasCostData && margin > 0) {
    // Determine color based on margin
    let color: 'success' | 'warning' | 'error' = 'success';
    if (margin < 15) color = 'error';
    else if (margin < 30) color = 'warning';

    return (
      <Chip 
        label={`${Math.round(margin)}%`}
        color={color}
        size="small"
        onClick={onClick}
        sx={{ cursor: 'pointer', minWidth: 60 }}
      />
    );
  }
  
    return (
        <Tooltip title="Add cost data">
          <IconButton 
            size="small" 
            onClick={onClick}
            sx={{ 
              border: '1px solid', 
              borderColor: 'divider',
              borderRadius: 1
            }}
          >
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      );
    };
