/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/components/widgets/widget-registry.ts

import React from 'react';
import { Box, Typography } from '@mui/material';

import { WidgetContentProps } from './types';
import { OrderMetricsWidget } from './OrderMetricsWidget';
import { CashFlowSnapshotWidget } from './CashFlowSnapshotWidget';
import { InventoryAlertsWidget } from './InventoryAlertsWidget';
import { TopProductsWidget } from './TopProductsWidget';
import { SalesByTrafficSourceWidget } from './SalesByTrafficSourceWidget';

// Extended definition for widgets in the registry
export interface WidgetDefinition extends WidgetContentProps {
  // The React component to render for this widget
  component: React.ComponentType<WidgetContentProps>;
  // Priority for ordering in survival mode
  priority: 'critical' | 'high' | 'medium' | 'low';
  // Whether this widget requires a paid plan
  requiresPaidPlan: boolean;
  // Data processing level required (for cost control)
  dataProcessing: 'light' | 'medium' | 'heavy';
}

// User configuration for widget selection
export interface UserWidgetConfig {
  detected_mode: 'survival' | 'growth' | 'architect';
  plan: 'free' | 'premium' | 'enterprise'; // Extend as needed
}

// The registry structure
export interface WidgetRegistry {
  survival: WidgetDefinition[];
  growth: WidgetDefinition[];
  architect: WidgetDefinition[];
}

/**
 * Placeholder widget for a future paid “Advanced Analytics” card.
 * This is a *real* React component, so React is happy, and
 * we still get a paid-only widget in the registry.
 */
const AdvancedAnalyticsWidget: React.FC<WidgetContentProps> = ({ title }) => {
  return (
    <Box p={2}>
      <Typography variant="h6" gutterBottom>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Advanced analytics will be available on paid plans.
        Upgrade to unlock deeper financial and cohort insights.
      </Typography>
    </Box>
  );
};

// Define the registry
export const WIDGET_REGISTRY: WidgetRegistry = {
  survival: [
    {
      id: 'cash-flow',
      title: 'Cash Flow',
      intelligenceLevel: 'L3',
      businessContext: { stage: 'survival', burningPriority: 'cash-flow' },
      metricConfig: { type: 'financial' },
      currentValue: 0,
      format: 'currency',
      isLoading: false,
      isEmpty: false,
      // optional props from WidgetContentProps:
      subtitle: undefined,
      icon: undefined,
      previousValue: undefined,
      targetValue: undefined,
      isStale: undefined,
      error: undefined,
      insightText: undefined,
      insightSeverity: undefined,
      primaryAction: undefined,
      secondaryActions: undefined,
      onEvent: undefined,
      listenedEvents: undefined,
      configMenu: undefined,
      headerLink: undefined,
      isConfigurable: undefined,
      refreshInterval: undefined,

      component: CashFlowSnapshotWidget,
      priority: 'critical',
      requiresPaidPlan: false,
      dataProcessing: 'light',
    },
    {
      id: 'inventory-alerts',
      title: 'Inventory Alerts',
      intelligenceLevel: 'L2',
      businessContext: { stage: 'survival', burningPriority: 'inventory' },
      metricConfig: { type: 'inventory' },
      currentValue: 0,
      format: 'number',
      isLoading: false,
      isEmpty: false,

      subtitle: undefined,
      icon: undefined,
      previousValue: undefined,
      targetValue: undefined,
      isStale: undefined,
      error: undefined,
      insightText: undefined,
      insightSeverity: undefined,
      primaryAction: undefined,
      secondaryActions: undefined,
      onEvent: undefined,
      listenedEvents: undefined,
      configMenu: undefined,
      headerLink: undefined,
      isConfigurable: undefined,
      refreshInterval: undefined,

      component: InventoryAlertsWidget,
      priority: 'high',
      requiresPaidPlan: false,
      dataProcessing: 'light',
    },
    {
      id: 'order-metrics',
      title: 'Order Metrics',
      intelligenceLevel: 'L1',
      businessContext: { stage: 'survival' },
      metricConfig: { type: 'growth' },
      currentValue: 0,
      format: 'number',
      isLoading: false,
      isEmpty: false,

      subtitle: undefined,
      icon: undefined,
      previousValue: undefined,
      targetValue: undefined,
      isStale: undefined,
      error: undefined,
      insightText: undefined,
      insightSeverity: undefined,
      primaryAction: undefined,
      secondaryActions: undefined,
      onEvent: undefined,
      listenedEvents: undefined,
      configMenu: undefined,
      headerLink: undefined,
      isConfigurable: undefined,
      refreshInterval: undefined,

      component: OrderMetricsWidget,
      priority: 'medium',
      requiresPaidPlan: false,
      dataProcessing: 'light',
    },
    {
      id: 'top-products',
      title: 'Top Selling Products',
      intelligenceLevel: 'L1',
      businessContext: { stage: 'survival' },
      metricConfig: { type: 'inventory' },
      currentValue: 0,
      format: 'number',
      isLoading: false,
      isEmpty: false,

      subtitle: undefined,
      icon: undefined,
      previousValue: undefined,
      targetValue: undefined,
      isStale: undefined,
      error: undefined,
      insightText: undefined,
      insightSeverity: undefined,
      primaryAction: undefined,
      secondaryActions: undefined,
      onEvent: undefined,
      listenedEvents: undefined,
      configMenu: undefined,
      headerLink: undefined,
      isConfigurable: undefined,
      refreshInterval: undefined,

      component: TopProductsWidget,
      priority: 'medium',
      requiresPaidPlan: false,
      dataProcessing: 'light',
    },
    {
      id: 'sales-by-traffic-source',
      title: 'Sales by Traffic Source',
      intelligenceLevel: 'L1',
      businessContext: { stage: 'survival' },
      metricConfig: { type: 'growth' },
      currentValue: 0,
      format: 'number',
      isLoading: false,
      isEmpty: false,

      subtitle: undefined,
      icon: undefined,
      previousValue: undefined,
      targetValue: undefined,
      isStale: undefined,
      error: undefined,
      insightText: undefined,
      insightSeverity: undefined,
      primaryAction: undefined,
      secondaryActions: undefined,
      onEvent: undefined,
      listenedEvents: undefined,
      configMenu: undefined,
      headerLink: undefined,
      isConfigurable: undefined,
      refreshInterval: undefined,

      component: SalesByTrafficSourceWidget,
      priority: 'medium',
      requiresPaidPlan: false,
      dataProcessing: 'light',
    },
    {
      id: 'advanced-analytics',
      title: 'Advanced Analytics',
      intelligenceLevel: 'L4',
      businessContext: { stage: 'survival' },
      metricConfig: { type: 'financial' },
      currentValue: 0,
      format: 'currency',
      isLoading: false,
      isEmpty: false,

      subtitle: undefined,
      icon: undefined,
      previousValue: undefined,
      targetValue: undefined,
      isStale: undefined,
      error: undefined,
      insightText: undefined,
      insightSeverity: undefined,
      primaryAction: undefined,
      secondaryActions: undefined,
      onEvent: undefined,
      listenedEvents: undefined,
      configMenu: undefined,
      headerLink: undefined,
      isConfigurable: undefined,
      refreshInterval: undefined,

      component: AdvancedAnalyticsWidget,
      priority: 'low',
      requiresPaidPlan: true,
      dataProcessing: 'heavy',
    },
  ],
  growth: [],
  architect: [],
};

// Helper function to get widgets for a user
export function getWidgetsForUser(user: UserWidgetConfig): WidgetDefinition[] {
  const modeWidgets = WIDGET_REGISTRY[user.detected_mode] || [];

  // Filter based on plan: if free, remove paid widgets
  const filteredWidgets = modeWidgets.filter((widget) =>
    user.plan === 'free' ? !widget.requiresPaidPlan : true
  );

  // Sort by priority (critical first) for survival mode
  if (user.detected_mode === 'survival') {
    const priorityOrder: Record<WidgetDefinition['priority'], number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };

    return filteredWidgets.sort(
      (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
    );
  }

  return filteredWidgets;
}
