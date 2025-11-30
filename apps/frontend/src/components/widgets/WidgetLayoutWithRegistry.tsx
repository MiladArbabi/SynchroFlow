/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/components/widgets/WidgetLayoutWithRegistry.tsx
import React from 'react';
import { Box } from '@mui/material';
import { EnhancedWidgetShell } from './EnhancedWidgetShell';
import { 
  EnhancedWidgetShellProps, 
  CommerceMetricConfig, 
  EcommerceBusinessContext 
} from './types';
import { useWidgetRegistry } from './useWidgetRegistry';
import { WidgetDefinition } from './widget-registry';

export const WidgetLayoutWithRegistry: React.FC = () => {
  const { widgets, isLoading, error } = useWidgetRegistry();

  if (isLoading) {
    return (
      <Box data-testid="layout-loading-skeleton" sx={{ p: 2 }}>
        Loading widgets from registry...
      </Box>
    );
  }

  if (error) {
    return (
      <Box data-testid="layout-error-state" sx={{ p: 2 }}>
        Error: {error.message}
      </Box>
    );
  }

  if (widgets.length === 0) {
    return (
      <Box data-testid="empty-layout-state" sx={{ textAlign: 'center', p: 3 }}>
        <h3>No widgets available</h3>
        <p>Configure your dashboard to see relevant metrics.</p>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      {widgets.map((widgetDef: WidgetDefinition) => {
        const { component: WidgetComponent, priority, requiresPaidPlan, dataProcessing, ...shellProps } = widgetDef;
        
        // Create proper EnhancedWidgetShellProps by reconstructing the required props
        const enhancedShellProps: EnhancedWidgetShellProps = {
          ...shellProps,
          // Ensure all required props are present
          businessContext: shellProps.businessContext as EcommerceBusinessContext,
          metricConfig: shellProps.metricConfig as CommerceMetricConfig,
          children: ( // We provide children here to satisfy TypeScript
            <WidgetComponent 
              {...shellProps}
              businessContext={shellProps.businessContext as EcommerceBusinessContext}
              metricConfig={shellProps.metricConfig as CommerceMetricConfig}
              children
            />
          )
        };
        return (
          <Box key={widgetDef.id} sx={{ mb: 2 }} data-testid={`widget-${widgetDef.id}`}>
             <EnhancedWidgetShell {...enhancedShellProps} />
          </Box>
        );
      })}
    </Box>
  );
};