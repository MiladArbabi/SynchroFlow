import type { ReactNode } from 'react';
/**
 * FT2StructuralProps
 * ------------------
 * Truth-bounded, non-temporal FT2 surface.
 * Default for all modules.
 */
export interface FT2StructuralProps {
    context: unknown;
    outcome?: unknown;
    trend?: unknown;
    signals?: unknown;
}
/**
 * FT2TemporalProps
 * ----------------
 * Explicit opt-in for temporal modules.
 * Orders ONLY (for now).
 */
export interface FT2TemporalProps extends FT2StructuralProps {
    timeseries: ReactNode;
    distribution: ReactNode;
}
