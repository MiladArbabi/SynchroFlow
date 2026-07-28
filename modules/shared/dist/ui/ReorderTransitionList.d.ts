import type { CSSProperties, ReactNode } from 'react';
export type ReorderTransitionListProps<TItem> = {
    items: readonly TItem[];
    getKey: (item: TItem) => string;
    renderItem: (item: TItem) => ReactNode;
    durationMs?: number;
    easing?: string;
    className?: string;
    itemClassName?: string;
    itemStyle?: CSSProperties;
};
/**
 * ReorderTransitionList
 * ---------------------
 * Generic FLIP-based list wrapper.
 *
 * Animates only when the rendered key order changes.
 *
 * This is intentional:
 * parent components often create new arrays on every render, and animating
 * from tiny layout deltas causes visual jitter in otherwise static lists.
 */
export declare function ReorderTransitionList<TItem>({ items, getKey, renderItem, durationMs, easing, className, itemClassName, itemStyle, }: ReorderTransitionListProps<TItem>): import("react").JSX.Element;
//# sourceMappingURL=ReorderTransitionList.d.ts.map