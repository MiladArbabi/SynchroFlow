/* eslint-disable @typescript-eslint/no-explicit-any */
//packages/ui/src/components/widgets/types.ts
import { LucideIcon } from 'lucide-react';
import { ReactNode } from 'react';

// E-commerce specific intelligence contexts
export interface EcommerceBusinessContext {
  stage: 'survival' | 'scaling' | 'enterprise';
  revenueBand?: '100k' | '1M' | '5M' | '10M' | '50M+';
  burningPriority?: 'cash-flow' | 'inventory' | 'acquisition' | 'team' | 'innovation';
  timeContext?: 'realtime' | 'daily' | 'weekly' | 'monthly' | 'quarterly';
}

// Commerce-specific metric configurations
export interface CommerceMetricConfig {
  type?: 'financial' | 'inventory' | 'customer' | 'team' | 'growth' | 'marketing';
  urgencyThresholds?: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  idealRanges?: {
    min: number;
    max: number;
  };
  industryBenchmarks?: {
    poor: number;
    average: number;
    good: number;
    excellent: number;
  };
}

// Enhanced primary action with commerce workflows
export interface CommercePrimaryAction {
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
  variant: 'primary' | 'secondary' | 'danger' | 'success';
  workflowType?: 'cash-optimization' | 'inventory-management' | 'customer-retention' | 'team-efficiency';
  expectedImpact?: 'high' | 'medium' | 'low';
  timeToComplete?: 'minutes' | 'hours' | 'days';
}

// Cross-widget communication events
export interface WidgetEvent {
  type: 'CRITICAL_ALERT' | 'DATA_UPDATE' | 'USER_ACTION' | 'CONTEXT_CHANGE';
  sourceWidget: string;
  payload: any;
  timestamp: Date;
}

// The complete EnhancedWidgetShell contract
export interface EnhancedWidgetShellProps {
  // --- CORE IDENTIFICATION ---
  id: string;
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  
  // --- COMMERCE INTELLIGENCE CONTEXT ---
  businessContext: Partial<EcommerceBusinessContext>;
  metricConfig: CommerceMetricConfig;
  
  // --- INTELLIGENCE LEVEL & CONTENT ---
  intelligenceLevel: 'L1' | 'L2' | 'L3' | 'L4';
  children: ReactNode;
  
  // --- COMMERCE-SPECIFIC DATA ---
  currentValue: number;
  previousValue?: number;
  targetValue?: number;
  format: 'currency' | 'percentage' | 'number' | 'days' | 'ratio';
  
  // --- DYNAMIC STATES ---
  isLoading: boolean;
  isStale?: boolean;
  isEmpty: boolean;
  error?: string;
  
  // --- INTELLIGENCE CONTENT ---
  insightText?: string;
  insightSeverity?: 'positive' | 'warning' | 'critical' | 'neutral';
  primaryAction?: CommercePrimaryAction;
  secondaryActions?: CommercePrimaryAction[];
  
  // --- CROSS-WIDGET COMMUNICATION ---
  onEvent?: (event: WidgetEvent) => void;
  listenedEvents?: string[];
  
  // --- CONFIGURATION ---
  configMenu?: ReactNode;
  headerLink?: string;
  isConfigurable?: boolean;
  refreshInterval?: number;
}

export type WidgetContentProps = Omit<EnhancedWidgetShellProps, 'children'>;