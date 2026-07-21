import { jsx as _jsx } from "react/jsx-runtime";
import { useLayoutEffect, useRef } from 'react';
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
export function ReorderTransitionList({ items, getKey, renderItem, durationMs = 420, easing = 'cubic-bezier(0.22, 1, 0.36, 1)', className, itemClassName, itemStyle, }) {
    const itemRefs = useRef(new Map());
    const previousRects = useRef(new Map());
    const previousKeyOrder = useRef('');
    useLayoutEffect(() => {
        const keys = items.map(getKey);
        const keyOrder = keys.join('|');
        const nextRects = new Map();
        itemRefs.current.forEach((node, key) => {
            nextRects.set(key, node.getBoundingClientRect());
        });
        const orderChanged = previousKeyOrder.current !== '' && previousKeyOrder.current !== keyOrder;
        previousKeyOrder.current = keyOrder;
        if (!orderChanged) {
            previousRects.current = nextRects;
            return;
        }
        const prefersReducedMotion = typeof window !== 'undefined' &&
            window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        if (prefersReducedMotion) {
            previousRects.current = nextRects;
            return;
        }
        nextRects.forEach((lastRect, key) => {
            const firstRect = previousRects.current.get(key);
            const node = itemRefs.current.get(key);
            if (!firstRect || !node)
                return;
            const deltaX = firstRect.left - lastRect.left;
            const deltaY = firstRect.top - lastRect.top;
            if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1)
                return;
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
    return (_jsx("div", { className: className, children: items.map((item) => {
            const key = getKey(item);
            return (_jsx("div", { ref: (node) => {
                    if (node)
                        itemRefs.current.set(key, node);
                    else
                        itemRefs.current.delete(key);
                }, className: itemClassName, style: itemStyle, children: renderItem(item) }, key));
        }) }));
}
