// apps/mobile/src/intelligence/helpers.ts
// Shared formatting and color helpers for Intelligence segment views.

import { colors } from '../theme';
import { MARGIN_TARGET, DemandVariant } from './types';

export function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toLocaleString()}`;
}

export function cashColor(v: number): string {
  return v > 0 ? colors.success : v < 0 ? colors.error : colors.ink3;
}

export function marginColor(pct: number): string {
  return pct >= MARGIN_TARGET ? colors.success : pct >= MARGIN_TARGET * 0.75 ? colors.warning : colors.error;
}

export function returnRateColor(pct: number): string {
  return pct >= 20 ? colors.error : pct >= 10 ? colors.warning : colors.success;
}

export function daysLabel(days: number | null): string {
  if (days === null) return 'Unknown';
  if (days === 0) return 'Stockout';
  return `${days}d left`;
}

export function statusVariant(s: DemandVariant['reorder_urgency']): 'error' | 'warning' | 'info' {
  return s === 'critical' ? 'error' : s === 'warning' ? 'warning' : 'info';
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}