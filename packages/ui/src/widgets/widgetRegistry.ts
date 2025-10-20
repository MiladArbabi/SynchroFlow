//packages/ui/src/widgets/widgetRegistry.ts
import { ComponentType } from "react";
import KpiCard from "../components/KpiCard";
import {CashFlowChart} from "../components/CashFlowChart";
import {InventoryHealthTable} from "../components/InventoryHealthTable";

export interface WidgetConfig {
  id: string;
  name: string;
  component: ComponentType<any>;
  defaultLayout: { w: number; h: number };
}

export const WIDGET_REGISTRY: Record<string, WidgetConfig> = {
  "kpi-revenue": {
    id: "kpi-revenue",
    name: "Gross Revenue",
    component: KpiCard,
    defaultLayout: { w: 3, h: 1 },
  },
  "kpi-margin": {
    id: "kpi-margin",
    name: "Gross Margin",
    component: KpiCard,
    defaultLayout: { w: 3, h: 1 },
  },
  "kpi-inventory": {
    id: "kpi-inventory",
    name: "Inventory Value",
    component: KpiCard,
    defaultLayout: { w: 3, h: 1 },
  },
  "cashflow-chart": {
    id: "cashflow-chart",
    name: "Cash Flow Chart",
    component: CashFlowChart,
    defaultLayout: { w: 9, h: 3 },
  },
  "inventory-health": {
    id: "inventory-health",
    name: "Inventory Health",
    component: InventoryHealthTable,
    defaultLayout: { w: 12, h: 4 },
  },
};

export const AVAILABLE_WIDGETS = Object.values(WIDGET_REGISTRY);