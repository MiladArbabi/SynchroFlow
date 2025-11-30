/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/components/widgets/widget-registry.ts
import React from 'react';
import { EnhancedWidgetShellProps } from './types';
import { OrderMetricsWidget } from './OrderMetricsWidget';
// import { CashFlowSnapshotWidget } from './CashFlowSnapshotWidget';
import { InventoryAlertsWidget } from './InventoryAlertsWidget';
import { TopProductsWidget } from './TopProductsWidget';
import { SalesByTrafficSourceWidget } from './SalesByTrafficSourceWidget';

// Extended definition for widgets in the registry
export interface WidgetDefinition extends Omit<EnhancedWidgetShellProps, 'children'> {
  // The component to render (will be passed the props from WidgetDefinition)
  component: React.ComponentType<EnhancedWidgetShellProps>;
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
      component: React.Component<any>,
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
      component: React.Component<any>, // Using existing component for demo
      priority: 'low',
      requiresPaidPlan: true, // This widget requires paid plan
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
  const filteredWidgets = modeWidgets.filter(widget => 
    user.plan !== 'free' || !widget.requiresPaidPlan
  );

  // Sort by priority (critical first) for survival mode
  if (user.detected_mode === 'survival') {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return filteredWidgets.sort((a, b) => 
      priorityOrder[a.priority] - priorityOrder[b.priority]
    );
  }

  return filteredWidgets;
}