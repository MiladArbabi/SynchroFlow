import React from 'react';
import { EnhancedWidgetShellProps } from './types';


export const CashFlowWidget: React.FC<EnhancedWidgetShellProps> = (props) => (
  <div>Cash Flow Widget: {props.currentValue}</div>
);

export const InventoryAlertsWidget: React.FC<EnhancedWidgetShellProps> = (props) => (
  <div>Inventory Alerts Widget: {props.currentValue}</div>
);

export const OrderMetricsWidget: React.FC<EnhancedWidgetShellProps> = (props) => (
  <div>Order Metrics Widget: {props.currentValue}</div>
);
