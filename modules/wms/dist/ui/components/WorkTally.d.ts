/**
 * Work tally — everything waiting on the floor, at a glance.
 *
 * WHY: the Warehouse page said "Pick and pack active batches", but four other
 * kinds of work queue up here — putting away, receiving, counting. An operator
 * landing on this page could not see what was waiting without scrolling
 * through sections that render empty most of the time.
 *
 * The five rows are FIXED and never reorder. Position becomes memory: an
 * operator learns where Counting sits and stops reading labels. Rows at zero
 * stay visible and go quiet rather than disappearing — a row that vanishes
 * teaches nothing, and discoverability is the whole point for work types a
 * merchant may not know exist yet.
 *
 * Counts are TASKS, not units. This answers "how many things need an
 * operator", not "how much volume is on the floor".
 *
 * VOCABULARY: merchant-facing words only. "Putting away", not stow.
 * "Counting", not recount or stocktake. No variance, no reconciliation.
 */
export interface WorkTallyCounts {
    picking: number;
    packing: number;
    puttingAway: number;
    receiving: number;
    counting: number;
}
export interface WorkTallyProps {
    counts: WorkTallyCounts;
    /**
     * Counting is Core-tier: a Starter tenant gets 403 from the recount routes
     * rather than an empty list. Locked renders the row as unavailable instead
     * of as zero — a zero would be a lie about work that may exist.
    */
    countingLocked?: boolean;
    onSelect?: (key: keyof WorkTallyCounts) => void;
}
export declare function WorkTally({ counts, countingLocked, onSelect }: WorkTallyProps): import("react").JSX.Element;
/** True when nothing anywhere is waiting — drives the "All clear" subtitle. */
export declare function isAllClear(counts: WorkTallyCounts): boolean;
//# sourceMappingURL=WorkTally.d.ts.map