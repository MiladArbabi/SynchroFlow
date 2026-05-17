/**
 * PickPathOverlay — Phase 2 stub.
 *
 * Renders a dashed SVG polyline connecting bins in pick order.
 * Interface is defined now so Phase 1 WarehouseGrid accepts the prop
 * without breaking changes when Phase 2 wires it.
 *
 * PHASE 2 ENGINEER: implement getSvgPoint() to map location_code →
 * (cx, cy) pixel coordinates from the rendered grid DOM, then draw
 * the polyline. gridRef from WarehouseGrid gives you the SVG element.
 *
 * DO NOT render anything until Phase 2 — returns null intentionally.
 */

export interface PickPathOverlayProps {
  /** Ordered location_codes defining the pick route */
  pickPath: string[];
  /** Ref to the parent SVG/container for coordinate mapping */
  gridRef?: React.RefObject<SVGSVGElement | null>;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function PickPathOverlay(_props: PickPathOverlayProps): null {
  // Phase 2 implementation goes here.
  return null;
}