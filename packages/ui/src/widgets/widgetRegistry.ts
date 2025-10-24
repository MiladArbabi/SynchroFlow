/* eslint-disable @typescript-eslint/no-explicit-any */
//packages/ui/src/widgets/widgetRegistry.ts
import { ComponentType } from "react";
import KpiCard from "../components/KpiCard";
import CashFlowWidget from './CashFlowWidget';
import InventoryHealthWidget from './InventoryHealthWidget';
import AOpexGauge from './AOpexGauge';

// Define possible plan levels
export type PlanLevel = 'Ignition' | 'Clarity' | 'Autonomous';

export interface WidgetConfig {
  id: string;
  name: string;
  component: ComponentType<any> | (() => string);
  defaultLayout: { w: number; h: number };
  requiredPlan: PlanLevel;
}

export const WIDGET_REGISTRY: Record<string, WidgetConfig> = {
  "kpi-revenue": {
    id: "kpi-revenue",
    name: "Gross Revenue",
    component: KpiCard,
    defaultLayout: { w: 3, h: 1 },
    requiredPlan: 'Ignition',
  },
  "kpi-margin": {
    id: "kpi-margin",
    name: "Gross Margin",
    component: KpiCard,
    defaultLayout: { w: 3, h: 1 },
    requiredPlan: 'Ignition',
  },
  "kpi-inventory": {
    id: "kpi-inventory",
    name: "Inventory Value",
    component: KpiCard,
    defaultLayout: { w: 3, h: 1 },
    requiredPlan: 'Clarity',
  },
  "cashflow-chart": {
    id: "cashflow-chart",
    name: "Cash Flow Chart",
    component: CashFlowWidget,
    defaultLayout: { w: 9, h: 3 },
    requiredPlan: 'Ignition',
  },
  "inventory-health": {
    id: "inventory-health",
    name: "Inventory Health",
    component: InventoryHealthWidget,
    defaultLayout: { w: 6, h: 4 },
    requiredPlan: 'Clarity',
  },
  "a-opex-gauge": {
    id: "a-opex-gauge",
    name: "Opex Saved",
    component: AOpexGauge,
    defaultLayout: { w: 3, h: 2 }, 
    requiredPlan: 'Ignition',
  },
  "ai-reordering": {
    id: "ai-reordering",
    name: "AI Smart Reordering",
    component: () => "AI Smart Reordering (Placeholder)",
    defaultLayout: { w: 6, h: 2},
    requiredPlan: 'Autonomous',
  },
};

export const AVAILABLE_WIDGETS = Object.values(WIDGET_REGISTRY);