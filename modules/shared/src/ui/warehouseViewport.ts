/** Screen-space camera calculations only; never change warehouse geometry. */
export type ViewportBounds = { minX: number; maxX: number; minY: number; maxY: number };
export type ViewportSize = { w: number; h: number };
export type WarehouseViewport = { zoom: number; offset: { x: number; y: number } };
export function boundsOfPoints(points: readonly { sx: number; sy: number }[]): ViewportBounds | null {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.sx) || !Number.isFinite(point.sy)) continue;
    minX = Math.min(minX, point.sx); maxX = Math.max(maxX, point.sx);
    minY = Math.min(minY, point.sy); maxY = Math.max(maxY, point.sy);
  }
  return minX === Infinity ? null : { minX, maxX, minY, maxY };
}
export function unionViewportBounds(...bounds: (ViewportBounds | null)[]): ViewportBounds | null {
  return boundsOfPoints(bounds.flatMap(b => b ? [{ sx: b.minX, sy: b.minY }, { sx: b.maxX, sy: b.maxY }] : []));
}
export function fitViewport(bounds: ViewportBounds | null, size: ViewportSize, maximum: number,
  padding = 0.9, reservedRatio = 0): WarehouseViewport | null {
  if (!bounds || !Number.isFinite(size.w) || !Number.isFinite(size.h) || size.w <= 0 || size.h <= 0) return null;
  const fitWidth = size.w * (1 - Math.min(0.4, Math.max(0, reservedRatio)));
  const safePadding = Number.isFinite(padding) ? Math.min(1, Math.max(0.01, padding)) : 0.9;
  const zoom = Math.min(maximum, Math.min(fitWidth / Math.max(1, bounds.maxX - bounds.minX),
    size.h / Math.max(1, bounds.maxY - bounds.minY)) * safePadding);
  return { zoom, offset: { x: fitWidth / 2 - (bounds.minX + bounds.maxX) * zoom / 2,
    y: size.h / 2 - (bounds.minY + bounds.maxY) * zoom / 2 } };
}
export function clampViewportOffset(offset: WarehouseViewport['offset'], zoom: number,
  bounds: ViewportBounds | null, size: ViewportSize, margin: number): WarehouseViewport['offset'] {
  if (!bounds || size.w <= 0 || size.h <= 0) return offset;
  const mx = Math.min(margin, size.w / 2, (bounds.maxX - bounds.minX) * zoom);
  const my = Math.min(margin, size.h / 2, (bounds.maxY - bounds.minY) * zoom);
  return { x: Math.min(size.w - mx - bounds.minX * zoom, Math.max(mx - bounds.maxX * zoom, offset.x)),
    y: Math.min(size.h - my - bounds.minY * zoom, Math.max(my - bounds.maxY * zoom, offset.y)) };
}
export function zoomViewportAtCenter(viewport: WarehouseViewport, delta: number, size: ViewportSize,
  bounds: ViewportBounds | null, minimum: number, maximum: number, margin: number): WarehouseViewport {
  // A fitted large floor can start below the manual minimum; minus must not zoom in.
  const zoom = Math.min(maximum, Math.max(Math.min(minimum, viewport.zoom), viewport.zoom + delta));
  const ratio = zoom / viewport.zoom;
  const offset = { x: size.w / 2 - (size.w / 2 - viewport.offset.x) * ratio,
    y: size.h / 2 - (size.h / 2 - viewport.offset.y) * ratio };
  return { zoom, offset: clampViewportOffset(offset, zoom, bounds, size, margin) };
}
export function preserveViewport(viewport: WarehouseViewport, previous: ViewportSize, next: ViewportSize,
  bounds: ViewportBounds | null, margin: number): WarehouseViewport {
  const offset = previous.w > 0 && previous.h > 0
    ? { x: viewport.offset.x + (next.w - previous.w) / 2, y: viewport.offset.y + (next.h - previous.h) / 2 }
    : viewport.offset;
  return { zoom: viewport.zoom, offset: clampViewportOffset(offset, viewport.zoom, bounds, next, margin) };
}
