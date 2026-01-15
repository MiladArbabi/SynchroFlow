export type FT2DateRangePreset =
  | 'today'
  | 'this_week'
  | 'last_week'
  | 'past_7_days'
  | 'this_month'
  | 'last_month'
  | 'past_30_days'
  | 'custom';

export interface FT2DateRange {
  preset: FT2DateRangePreset;
  from: string; // ISO-8601 UTC
  to: string;   // ISO-8601 UTC
}