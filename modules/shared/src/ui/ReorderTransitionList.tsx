import { useLayoutEffect, useRef } from 'react';
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
export function ReorderTransitionList<TItem>({
  items,
  getKey,
  renderItem,
  durationMs = 420,
  easing = 'cubic-bezier(0.22, 1, 0.36, 1)',
  className,
  itemClassName,
  itemStyle,
}: ReorderTransitionListProps<TItem>) {
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const previousRects = useRef<Map<string, DOMRect>>(new Map());
  const previousKeyOrder = useRef<string>('');

  useLayoutEffect(() => {
    const keys = items.map(getKey);
    const keyOrder = keys.join('|');

    const nextRects = new Map<string, DOMRect>();

    itemRefs.current.forEach((node, key) => {
      nextRects.set(key, node.getBoundingClientRect());
    });

    const orderChanged = previousKeyOrder.current !== '' && previousKeyOrder.current !== keyOrder;

    previousKeyOrder.current = keyOrder;

    if (!orderChanged) {
      previousRects.current = nextRects;
      return;
    }

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      previousRects.current = nextRects;
      return;
    }

    nextRects.forEach((lastRect, key) => {
      const firstRect = previousRects.current.get(key);
      const node = itemRefs.current.get(key);

      if (!firstRect || !node) return;

      const deltaX = firstRect.left - lastRect.left;
      const deltaY = firstRect.top - lastRect.top;

      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;

      node.style.transition = 'none';
      node.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
      node.style.willChange = 'transform';

      requestAnimationFrame(() => {
        node.style.transition = `transform ${durationMs}ms ${easing}`;
        node.style.transform = 'translate3d(0, 0, 0)';
      });

      window.setTimeout(() => {
        node.style.transition = '';
        node.style.transform = '';
        node.style.willChange = '';
      }, durationMs + 80);
    });

    previousRects.current = nextRects;
  });

  return (
    <div className={className}>
      {items.map((item) => {
        const key = getKey(item);

        return (
          <div
            key={key}
            ref={(node) => {
              if (node) itemRefs.current.set(key, node);
              else itemRefs.current.delete(key);
            }}
            className={itemClassName}
            style={itemStyle}
          >
            {renderItem(item)}
          </div>
        );
      })}
    </div>
  );
}