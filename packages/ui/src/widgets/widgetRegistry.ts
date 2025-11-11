/* eslint-disable @typescript-eslint/no-explicit-any */
// packages/ui/src/widgets/widgetRegistry.ts
import { ComponentType } from "react";
import KpiCard from "../components/KpiCard";
import CashFlowWidget from './CashFlowWidget';
import InventoryHealthWidget from './InventoryHealthWidget';
import AOpexGauge from './AOpexGauge';

// Define possible plan levels
export type PlanLevel = 'Spark' | 'Ignition' | 'Clarity' | 'Autonomous';

/**
 * Defines a specific, addable version of a widget.
 * This is what the user picks from the WidgetLibrary.
 */
export interface WidgetVariant {
  variantId: string;      // The unique ID for this specific variant, e.g., "kpi-revenue"
  displayName: string;    // The user-facing name, e.g., "Gross Revenue"
  w: number;              // The default and fixed width
  h: number;              // The default and fixed height
  isResizable: boolean;   // Should be 'false' for the iOS experience
}

/**
 * Defines a generic widget component and all its available variants.
 */
export interface WidgetConfig {
  name: string;             // The generic name, e.g., "KPI Card"
  component: ComponentType<any> | (() => string);
  requiredPlan: PlanLevel;
  variants: WidgetVariant[]; // An array of all available sizes/types
}

/**
 * The new Widget Registry.
 *
 * This is now a Record keyed by the *generic* widget ID (e.g., "kpi").
 * This allows us to group all KPI variants under one parent component.
 */
export const WIDGET_REGISTRY: Record<string, WidgetConfig> = {
  // --- KPI Widget Group ---
  "kpi": {
    name: "KPI Card",
    component: KpiCard,
    requiredPlan: 'Ignition',
    variants: [
      {
        variantId: "kpi-revenue",
        displayName: "Gross Revenue",
        w: 3, h: 1,
        isResizable: false
      },
      {
        variantId: "kpi-margin",
        displayName: "Gross Margin",
        w: 3, h: 1,
        isResizable: false
      },
      {
        variantId: "kpi-inventory",
        displayName: "Inventory Value",
        w: 3, h: 1,
        isResizable: false
        // Note: We'll need to handle the 'Clarity' plan lock in the WidgetLibrary
      }
    ]
  },
  // --- Cashflow Widget Group ---
  "cashflow": {
    name: "Cash Flow Chart",
    component: CashFlowWidget,
    requiredPlan: 'Ignition',
    variants: [
      {
        variantId: "cashflow-chart-large", // Renamed old ID
        displayName: "Cash Flow (Large)",
        w: 9, h: 3,
        isResizable: false
      }
      // We could add a new variant here later, e.g.:
      // {
      //   variantId: "cashflow-chart-small",
      //   displayName: "Cash Flow (Small)",
      //   w: 6, h: 3,
      //   isResizable: false
      // }
    ]
  },
  // --- Inventory Health Group ---
  "inventory-health": {
    name: "Inventory Health",
    component: InventoryHealthWidget,
    requiredPlan: 'Clarity',
    variants: [
      {
        variantId: "inventory-health-table", // Renamed old ID
        displayName: "Inventory Health Table",
        w: 6, h: 4,
        isResizable: false
      }
    ]
  },
  // --- Opex Gauge Group ---
  "opex-gauge": {
    name: "Opex Saved",
    component: AOpexGauge,
    requiredPlan: 'Ignition',
    variants: [
      {
        variantId: "a-opex-gauge", // Used old ID
        displayName: "Opex Saved Gauge",
        w: 3, h: 2,
        isResizable: false
      }
    ]
  },
  // --- AI Reordering Group ---
  "ai-reordering": {
    name: "AI Smart Reordering",
    component: () => "AI Smart Reordering (Placeholder)",
    requiredPlan: 'Autonomous',
    variants: [
      {
        variantId: "ai-reordering-list", // Renamed old ID
        displayName: "AI Smart Reordering",
        w: 6, h: 2,
        isResizable: false
      }
    ]
  },
};

// --- NEW HELPER FUNCTION ---
/**
 * A helper to find both the parent component and the specific variant
 * config from just a variantId.
 */
export function getWidgetConfigByVariantId(variantId: string): {
  parentConfig: WidgetConfig;
  variant: WidgetVariant;
} | undefined {
  // Loop through all parent widgets
  for (const parentConfig of Object.values(WIDGET_REGISTRY)) {
    // Loop through all variants of that parent
    for (const variant of parentConfig.variants) {
      if (variant.variantId === variantId) {
        return { parentConfig, variant };
      }
    }
  }
  return undefined; // Not found
}