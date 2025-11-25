// In packages/ui/src/components/CostStatusIndicator.tsx - Replace the current implementation:
/* eslint-disable @typescript-eslint/no-explicit-any */
// packages/ui/src/components/CostStatusIndicator.tsx
import React from 'react';
import { Chip, IconButton, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';
import ErrorIcon from '@mui/icons-material/Error';

interface CostStatusIndicatorProps {
  product: any;
  onClick: () => void;
}

export const CostStatusIndicator: React.FC<CostStatusIndicatorProps> = ({
  product,
  onClick
}) => {
  console.log('🔍 CostStatusIndicator - Product data:', {
    id: product.id,
    purchase_price: product.purchase_price,
    landed_cost_per_unit: product.landed_cost_per_unit,
    selling_price: product.selling_price,
    last_cost_update: product.last_cost_update,
    margin: product.margin
  });

  const getCostStatus = () => {
    if (!product.last_cost_update) {
      return { status: 'missing', color: 'error' as const, label: 'Never Set', icon: <ErrorIcon /> };
    }

    const lastUpdate = new Date(product.last_cost_update);
    const now = new Date();
    const daysSinceUpdate = Math.floor((now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSinceUpdate <= 30) {
      return { 
        status: 'healthy', 
        color: 'success' as const, 
        label: `Updated ${daysSinceUpdate}d ago`,
        icon: <CheckCircleIcon />
      };
    } else if (daysSinceUpdate <= 90) {
      return { 
        status: 'needs_review', 
        color: 'warning' as const, 
        label: `Updated ${daysSinceUpdate}d ago`,
        icon: <WarningIcon />
      };
    } else {
      return { 
        status: 'outdated', 
        color: 'error' as const, 
        label: `Updated ${daysSinceUpdate}d ago`,
        icon: <ErrorIcon />
      };
    }
  };

  const costStatus = getCostStatus();

  if (costStatus.status === 'missing') {
    return (
      <Tooltip title="No cost data set - click to add">
        <IconButton 
          size="small" 
          onClick={onClick}
          sx={{ 
            border: '1px solid', 
            borderColor: 'error.main',
            borderRadius: 1,
            color: 'error.main'
          }}
        >
          <AddIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    );
  }

  return (
    <Tooltip title={`Cost data ${costStatus.status.replace('_', ' ')} - click to edit`}>
      <Chip 
        icon={costStatus.icon}
        label={costStatus.label}
        color={costStatus.color}
        size="small"
        onClick={onClick}
        sx={{ cursor: 'pointer', minWidth: 120 }}
        variant={costStatus.status === 'healthy' ? 'filled' : 'outlined'}
      />
    </Tooltip>
  );
};