/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/components/widgets/WidgetLayout.tsx
import React from 'react';
import { Box, Grid, Typography } from '@mui/material';
import { EnhancedWidgetShell } from './EnhancedWidgetShell';
import { useDashboardState } from '../../contexts/DashboardStateContext';

interface WidgetLayoutProps {
  widgets: Array<{
    id: string;
    title: string;
    intelligenceLevel: 'L1' | 'L2' | 'L3' | 'L4';
    priority: 'critical' | 'high' | 'medium';
    businessContext: any;
    metricConfig: any;
    currentValue: number;
    format: 'currency' | 'percentage' | 'number' | 'days' | 'ratio';
    isLoading?: boolean;
    isEmpty?: boolean;
    error?: string;
  }>;
  isLoading?: boolean;
}

export const WidgetLayout: React.FC<WidgetLayoutProps> = ({ widgets, isLoading = false }) => {
  const { currentView } = useDashboardState();

  if (isLoading) {
    return (
      <Box data-testid="layout-loading-skeleton" sx={{ p: 2 }}>
        <Typography>Loading widgets...</Typography>
      </Box>
    );
  }

  if (widgets.length === 0) {
    return (
      <Box data-testid="empty-layout-state" sx={{ textAlign: 'center', p: 3 }}>
        <Typography variant="h3">No widgets available</Typography>
        <Typography variant="body1">Configure your dashboard to see relevant metrics.</Typography>
      </Box>
    );
  }

  // Different layouts based on user mode
  switch (currentView) {
    case 'survival':
      return <SurvivalModeLayout widgets={widgets} />;
    case 'growth':
      return <GrowthModeLayout widgets={widgets} />;
    case 'architect':
      return <ArchitectModeLayout widgets={widgets} />;
    default:
      return <SurvivalModeLayout widgets={widgets} />;
  }
};

const SurvivalModeLayout: React.FC<{ widgets: any[] }> = ({ widgets }) => {
  // Sort by priority: critical first
  const sortedWidgets = widgets.sort((a, b) => {
    const priorityOrder = { critical: 0, high: 1, medium: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 2 }}>
      {sortedWidgets.map((widget) => (
        <EnhancedWidgetShell
          key={widget.id}
          {...widget}
          businessContext={{ ...widget.businessContext, stage: 'survival' }}
        >
          <Box sx={{ p: 2 }}>
            <Typography variant="h4" component="div">
              {widget.currentValue}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {widget.title}
            </Typography>
          </Box>
        </EnhancedWidgetShell>
      ))}
    </Box>
  );
};

// Placeholder for other layouts
const GrowthModeLayout: React.FC<{ widgets: any[] }> = ({ widgets }) => (
  <Grid container spacing={2} sx={{ p: 2 }}>
    {widgets.map((widget) => (
      <Grid key={widget.id} size={{ xs: 12, md: 6 }}>
        <EnhancedWidgetShell {...widget}>
          <Box sx={{ p: 2 }}>
            <Typography variant="h4">{widget.currentValue}</Typography>
            <Typography variant="body2">{widget.title}</Typography>
          </Box>
        </EnhancedWidgetShell>
      </Grid>
    ))}
  </Grid>
);

const ArchitectModeLayout: React.FC<{ widgets: any[] }> = ({ widgets }) => (
  <Grid container spacing={2} sx={{ p: 2 }}>
    {widgets.map((widget) => (
      <Grid key={widget.id} size={{ xs: 12, md: 4 }}>
        <EnhancedWidgetShell {...widget}>
          <Box sx={{ p: 2 }}>
            <Typography variant="h4">{widget.currentValue}</Typography>
            <Typography variant="body2">{widget.title}</Typography>
          </Box>
        </EnhancedWidgetShell>
      </Grid>
    ))}
  </Grid>
);