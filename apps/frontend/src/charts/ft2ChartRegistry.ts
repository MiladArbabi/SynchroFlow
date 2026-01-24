/**
 * FT2 Chart Registry
 * ==================
 * Single source of truth for all FT2 visualizations.
 *
 * RULES (ENFORCED):
 * - No trends
 * - No smoothing
 * - No semantic colors
 * - No benchmarks
 * - No annotations
 * - No targets
 *
 * If a chart is not here, it is NOT FT2-safe.
 */

import { ApexOptions } from "apexcharts";

export const FT2_CHART_RULES = Object.freeze({
  animations: false,
  gradients: false,
  semanticColors: false,
  smoothing: false,
  benchmarks: false,
  targets: false,
  annotations: false
});

/* ─────────────────────────────────────────────
 * Orders — Timeseries (FACTS ONLY)
 * ───────────────────────────────────────────── */
export const ORDERS_FT2_TIMESERIES: ApexOptions = {
  chart: {
    id: 'orders-ft2-timeseries',
    sparkline: { enabled: true },
    background: 'transparent',
    animations: { enabled: false }
  },
  stroke: {
    curve: 'smooth', // ✅ literal, not string
    width: 2
  },
  markers: {
    size: 0,
    hover: { size: 0 }
  },
  tooltip: {
    enabled: true,
    x: { formatter: () => 'Time' },
    y: { formatter: (v: number) => `Orders: ${v}` }
  },
  xaxis: {
    labels: { show: false }
  },
  yaxis: {
    labels: { show: false }
  },
  grid: { show: false },
  colors: ['#90caf9']
};

/* ─────────────────────────────────────────────
 * Orders — Distribution (FACT SHAPE ONLY)
 * ───────────────────────────────────────────── */
export const ORDERS_FT2_DISTRIBUTION: ApexOptions = {
  chart: {
    id: 'orders-ft2-distribution',
    sparkline: { enabled: true },
    background: 'transparent',
    animations: { enabled: false }
  },
  plotOptions: {
    bar: {
      columnWidth: '55%',
      distributed: true
    }
  },
  dataLabels: { enabled: false },
  tooltip: {
    enabled: true,
    y: {
      formatter: (v: number) => String(v) // ✅ string
    }
  },
  xaxis: {
    labels: { show: false }
  },
  yaxis: {
    labels: { show: false }
  },
  grid: { show: false }
};