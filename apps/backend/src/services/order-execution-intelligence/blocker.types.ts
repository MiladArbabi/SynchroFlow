// L2 Blocker Classifier — INTERNAL ONLY
// -----------------------------------
// Purpose:
// Classify WHY revenue is not converting yet.
// This never surfaces directly to FT2.

export type BlockerCategory =
  | 'awaiting_fulfillment'   // normal open work
  | 'stalled_execution'      // aged execution
  | 'missing_execution'      // synthetic execution only
  | 'unknown';               // safety fallback

export interface BlockerClassification {
  canonicalOrderId: string;
  category: BlockerCategory;
  revenue: number;
}
