import {
  FT2Stat,
  FT2Ratio,
  FT2Distribution,
  FT2TimeSeries,
  FT2DualTimeSeries,
  FT2Scatter,
  FT2ImpactMatrix,
} from '@lasyncro/ui-ft2';

import { runFT2Invariants } from './ft2InvariantHarness';

/* ─────────────────────────────────────────────
 * FT2Stat
 * { value: number | null }
 * ───────────────────────────────────────────── */
runFT2Invariants({
  name: 'FT2Stat',
  Component: FT2Stat,
  validProps: { value: 10 },
  nullProps: { value: null },
});

/* ─────────────────────────────────────────────
 * FT2Ratio
 * { numerator: number | null; denominator: number | null }
 * ───────────────────────────────────────────── */
runFT2Invariants({
  name: 'FT2Ratio',
  Component: FT2Ratio,
  validProps: { numerator: 5, denominator: 10 },
  nullProps: { numerator: null, denominator: null },
});

/* ─────────────────────────────────────────────
 * FT2Distribution
 * { buckets: { key: string; value: number | null }[] | null }
 * ───────────────────────────────────────────── */
runFT2Invariants({
  name: 'FT2Distribution',
  Component: FT2Distribution,
  validProps: {
    buckets: [{ key: 'A', value: 3 }],
  },
  nullProps: {
    buckets: null,
  },
});

/* ─────────────────────────────────────────────
 * FT2TimeSeries
 * { points: { x: string; y: number | null }[] | null }
 * ───────────────────────────────────────────── */
runFT2Invariants({
  name: 'FT2TimeSeries',
  Component: FT2TimeSeries,
  validProps: {
    points: [{ x: '2024-01-01', y: 1 }],
  },
  nullProps: {
    points: null,
  },
});

/* ─────────────────────────────────────────────
 * FT2DualTimeSeries
 * {
 *   left:  { date: string; value: number | null }[] | null
 *   right: { date: string; value: number | null }[] | null
 * }
 * ───────────────────────────────────────────── */
runFT2Invariants({
  name: 'FT2DualTimeSeries',
  Component: FT2DualTimeSeries,
  validProps: {
    left: [{ date: '2024-01-01', value: 1 }],
    right: [{ date: '2024-01-01', value: 2 }],
  },
  nullProps: {
    left: null,
    right: null,
  },
});

/* ─────────────────────────────────────────────
 * FT2Scatter
 * { points: { x: number | null; y: number | null }[] | null }
 * ───────────────────────────────────────────── */
runFT2Invariants({
  name: 'FT2Scatter',
  Component: FT2Scatter,
  validProps: {
    points: [{ x: 1, y: 2 }],
  },
  nullProps: {
    points: null,
  },
});

/* ─────────────────────────────────────────────
 * FT2ImpactMatrix
 * {
 *   xLabels: string[] | null
 *   yLabels: string[] | null
 *   cells: { x: string; y: string; value: number | null }[] | null
 * }
 * ───────────────────────────────────────────── */
runFT2Invariants({
  name: 'FT2ImpactMatrix',
  Component: FT2ImpactMatrix,
  validProps: {
    xLabels: ['X'],
    yLabels: ['Y'],
    cells: [{ x: 'X', y: 'Y', value: 1 }],
  },
  nullProps: {
    xLabels: null,
    yLabels: null,
    cells: null,
  },
});