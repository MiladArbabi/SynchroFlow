/**
 * Faithful transplant of the 2.5D warehouse world from packages/landing-page/index.html
 * (the #ls-fit -> #ls-cam -> perspective wrapper -> #ls-plane hierarchy and its
 * absolutely positioned zone DOM). Every value below is copied verbatim from that
 * source. Do not eyeball replacements.
 *
 * NOT transplanted in this slice (deferred): the landing per-scene camera
 * choreography, the scroll-driven scene machine, and the scene-gated `data-show`
 * choreography elements (arrival/departure trucks, right-hand yard strip, moving
 * cartons/parcels/markers).
 */

export const WAREHOUSE_PLANE = {
  // #ls-plane
  WIDTH: 1100,
  HEIGHT: 700,
  MARGIN_LEFT: -550,
  MARGIN_TOP: -385,
  TRANSFORM: 'rotateX(48deg) rotateZ(-32deg)',
  // perspective wrapper
  PERSPECTIVE: 1700,
  // plane skin
  BORDER: '1px solid rgba(255,255,255,0.09)',
  BORDER_RADIUS: 4,
  BOX_SHADOW: '0 60px 120px rgba(0,0,0,0.5)',
  BACKGROUND_COLOR: 'rgba(255,255,255,0.012)',
  GRID_IMAGE:
    'repeating-linear-gradient(0deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 50px), ' +
    'repeating-linear-gradient(90deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 50px)',
  // landing sticky-stage radial background behind the plane
  STAGE_BACKGROUND: 'radial-gradient(ellipse 80% 60% at 50% 42%, #16202F 0%, #0B111C 70%)',
} as const;

/**
 * #ls-fit responsive fit. Landing source:
 *   Math.min(window.innerWidth / 1320, window.innerHeight / 980, 1)
 * Applied here against the post-OAuth right-panel box instead of the viewport.
 */
export const WAREHOUSE_FIT = {
  WIDTH_DIVISOR: 1320,
  HEIGHT_DIVISOR: 980,
  MAX: 1,
  INITIAL: 0.42,
} as const;

/** Neutral camera for this slice (landing scene-0 value): translate(0,0) scale(1). */
export const WAREHOUSE_NEUTRAL_CAMERA = 'translate(0px, 0px) scale(1)';
export const WAREHOUSE_CAMERA_TRANSITION = 'transform 1.1s cubic-bezier(0.22, 1, 0.36, 1)';

export interface WarehouseZoneGeometry {
  id: string;
  label: string;
  left: number;
  top: number;
  width: number;
  height: number;
  borderRadius: number;
  background: string;
}

const STANDARD_ZONE_BG = 'rgba(255,255,255,0.025)';

/** The eight absolutely positioned areas inside #ls-plane (landing lines 847-945). */
export const WAREHOUSE_ZONES: WarehouseZoneGeometry[] = [
  { id: 'admin', label: 'PO desk', left: 70, top: 470, width: 120, height: 160, borderRadius: 6, background: STANDARD_ZONE_BG },
  { id: 'dock', label: 'Inbound dock', left: 70, top: 90, width: 130, height: 200, borderRadius: 6, background: STANDARD_ZONE_BG },
  { id: 'receive', label: 'Receive', left: 228, top: 90, width: 148, height: 260, borderRadius: 6, background: STANDARD_ZONE_BG },
  { id: 'stow', label: 'Stow', left: 412, top: 90, width: 148, height: 260, borderRadius: 6, background: STANDARD_ZONE_BG },
  { id: 'shelves', label: 'Inventory', left: 590, top: 80, width: 306, height: 368, borderRadius: 10, background: 'rgba(255,255,255,0.012)' },
  { id: 'orders', label: 'Orders', left: 930, top: 80, width: 120, height: 130, borderRadius: 6, background: STANDARD_ZONE_BG },
  { id: 'pack', label: 'Pack', left: 930, top: 250, width: 120, height: 190, borderRadius: 6, background: STANDARD_ZONE_BG },
  { id: 'outbound', label: 'Outbound', left: 880, top: 510, width: 170, height: 140, borderRadius: 6, background: STANDARD_ZONE_BG },
];

/** Barcode gate between receive and stow (landing [data-gate], lines 865-874). */
export const WAREHOUSE_GATE = {
  left: 374,
  top: 168,
  width: 30,
  height: 108,
  opacity: 0.35,
  bars: [
    { left: 0, width: 3, background: 'rgba(240,238,232,0.82)', radius: 1 },
    { left: 5, width: 1, background: 'rgba(240,238,232,0.52)', radius: 0 },
    { left: 8, width: 4, background: 'rgba(240,238,232,0.82)', radius: 1 },
    { left: 14, width: 1, background: 'rgba(240,238,232,0.52)', radius: 0 },
    { left: 17, width: 2, background: 'rgba(240,238,232,0.68)', radius: 1 },
    { left: 21, width: 3, background: 'rgba(240,238,232,0.82)', radius: 1 },
    { left: 26, width: 1, background: 'rgba(240,238,232,0.52)', radius: 0 },
  ],
} as const;

/** Always-on left road / yard strip (landing line 833). */
export const WAREHOUSE_YARD_STRIP = {
  width: 54,
  background: 'rgba(0,0,0,0.25)',
  borderRight: '1px dashed rgba(255,255,255,0.10)',
} as const;

/**
 * Inventory / pick-map slot grid inside the shelves zone
 * (landing .ls-pick-grid / .ls-pick-column / .ls-pick-slot, lines 189-219 + 895-921).
 */
export const PICK_GRID = {
  left: 24,
  top: 52,
  width: 258,
  columns: [
    ['', 'is-cool', '', '', 'is-warm', ''],
    ['', '', 'is-warm', '', 'is-cool', ''],
    ['', 'is-cool', '', 'is-warm', '', ''],
  ],
} as const;

// ---------------------------------------------------------------------------
// SCENE_2 actors (inbound pallet: truck -> Inbound Dock -> Receive -> unpack)
// ---------------------------------------------------------------------------

/** PO-1048 stays at the desk as a subdued context element during SCENE_2. */
export const SCENE2_PO_CONTEXT_OPACITY = 0.5;

/**
 * One inbound pallet — a DOM actor on the tilted plane. Plane coords.
 *   start     = at the parked truck's right (unloading) flank
 *   atDock    = translate to inside [data-zone="dock"]     (70,90,130x200)
 *   atReceive = translate to inside [data-zone="receive"]  (228,90,148x260)
 * The pallet never routes through Stow / Inventory; it holds briefly at the dock.
 */
export const INBOUND_PALLET = {
  width: 46,
  height: 26,
  start: { left: 34, top: 152 },
  atDock: { x: 58, y: 20 },
  atReceive: { x: 236, y: 34 },
  cartons: [
    { left: 4, top: -13, size: 15, background: '#2E3D62', border: 'rgba(255,255,255,0.18)' },
    { left: 22, top: -13, size: 15, background: '#243050', border: 'rgba(255,255,255,0.16)' },
    { left: 13, top: -26, size: 14, background: '#2E3D62', border: 'rgba(255,255,255,0.18)' },
  ],
} as const;

/** SCENE_2 unpacked goods revealed at Receive (actor-overlay 960x648 coords). */
export const SCENE2_RECEIVE_PRODUCTS = { x: 236, y: 150, scale: 0.4 } as const;

// ---------------------------------------------------------------------------
// SCENE_3 actors (individual products: Receive -> barcode gate -> Stow queue)
// ---------------------------------------------------------------------------

/** The five representative products processed in SCENE_3 (received-load continuity). */
export const SCENE3_PRODUCTS = ['bottle', 'pouch', 'box', 'carton', 'jar'] as const;

/**
 * SCENE_3 product route, in actor-overlay 960x648 coords.
 *   start     = on the pallet inside [data-zone="receive"]
 *   gate      = passing [data-gate] (physically between Receive and Stow)
 *   stowSlots = a 5-slot orderly queue inside [data-zone="stow"], spaced for readability
 * Route is Receive -> gate -> Stow only; never through Inventory / Orders.
 */
export const SCENE3_PRODUCT_ROUTE = {
  start: { x: 236, y: 156 },
  startStagger: 8,
  gate: { x: 338, y: 200 },
  stowSlots: [
    { x: 372, y: 116 },
    { x: 372, y: 142 },
    { x: 372, y: 168 },
    { x: 372, y: 194 },
    { x: 372, y: 220 },
  ],
  productScale: 0.62,
} as const;

/** Five cartons on the SCENE_3 pallet — one fades as each product leaves Receive. */
export const SCENE3_PALLET_CARTONS = [
  { left: 3, top: -12, size: 13, background: '#2E3D62', border: 'rgba(255,255,255,0.18)' },
  { left: 17, top: -12, size: 13, background: '#243050', border: 'rgba(255,255,255,0.16)' },
  { left: 31, top: -12, size: 13, background: '#2E3D62', border: 'rgba(255,255,255,0.18)' },
  { left: 10, top: -24, size: 13, background: '#243050', border: 'rgba(255,255,255,0.16)' },
  { left: 24, top: -24, size: 13, background: '#2E3D62', border: 'rgba(255,255,255,0.18)' },
] as const;

/**
 * SCENE_3 phase timeline — fractions of the canonical SCENE_3 duration, ONE
 * product at a time. Order per product i (1..5): pI-move, pI-gate, pI-stow; then settled.
 * Each product owns an 18% window; the gate-confirm sub-window (pI-gate) is widened to
 * ~9% (~290ms) so the green beat is clearly perceptible. Kept in sync with the CSS
 * @keyframes percentages generated in WorkflowFilm.
 */
export const SCENE3_PHASES = [
  'p1-move', 'p1-gate', 'p1-stow',
  'p2-move', 'p2-gate', 'p2-stow',
  'p3-move', 'p3-gate', 'p3-stow',
  'p4-move', 'p4-gate', 'p4-stow',
  'p5-move', 'p5-gate', 'p5-stow',
  'settled',
] as const;
export const SCENE3_PHASE_THRESHOLDS = [
  0.00, 0.05, 0.14,
  0.18, 0.23, 0.32,
  0.36, 0.41, 0.50,
  0.54, 0.59, 0.68,
  0.72, 0.77, 0.86,
  0.90,
] as const;

// ---------------------------------------------------------------------------
// SCENE_4 actors (put away: the five barcoded products leave the Stow queue and
// travel one at a time to their assigned Inventory bin, which confirms each
// placement). Continues directly from the settled end of SCENE_3.
// ---------------------------------------------------------------------------

/**
 * Put-away route, in actor-overlay 960x648 coords.
 *   origin = the SCENE_3 Stow-queue resting slots (unchanged, carried forward)
 *   bins   = five destination slots inside [data-zone="shelves"] ("Inventory",
 *            plane 590,80,306x368). Positions follow the landing-page
 *            `data-stow-target` scatter inside that field
 *            (packages/landing-page/index.html lines 923-926), projected to the
 *            actor-overlay units and extended from three markers to five.
 * Route is Stow -> Inventory bin only; never Orders / Pack / Outbound / Receive.
 */
export const SCENE4_PUTAWAY = {
  origin: SCENE3_PRODUCT_ROUTE.stowSlots,
  productScale: SCENE3_PRODUCT_ROUTE.productScale,
  bins: [
    { productId: 'bottle', binId: 'A-01', x: 560, y: 150 },
    { productId: 'pouch', binId: 'B-01', x: 690, y: 176 },
    { productId: 'box', binId: 'C-01', x: 600, y: 232 },
    { productId: 'carton', binId: 'D-02', x: 736, y: 264 },
    { productId: 'jar', binId: 'E-02', x: 642, y: 320 },
  ],
} as const;

/**
 * SCENE_4 phase timeline — fractions of the canonical SCENE_4 duration, ONE
 * product at a time. A short global lead-in keeps all five visibly queued at
 * scene start; then per product i (1..5): pI-move, pI-confirm, pI-settle; then
 * settled. Kept in sync with the CSS @keyframes percentages generated in
 * WorkflowFilm.
 */
export const SCENE4_PHASES = [
  'lead-in',
  'p1-move', 'p1-confirm', 'p1-settle',
  'p2-move', 'p2-confirm', 'p2-settle',
  'p3-move', 'p3-confirm', 'p3-settle',
  'p4-move', 'p4-confirm', 'p4-settle',
  'p5-move', 'p5-confirm', 'p5-settle',
  'settled',
] as const;
export const SCENE4_PHASE_THRESHOLDS = [
  0.00,
  0.03, 0.12, 0.18,
  0.21, 0.30, 0.36,
  0.39, 0.48, 0.54,
  0.57, 0.66, 0.72,
  0.75, 0.84, 0.90,
  0.92,
] as const;

// ---------------------------------------------------------------------------
// SCENE_5 actors (trolley pick route): three orders are released in the Order
// Pool; ONE picking trolley travels into the Inventory area, zig-zags the real
// SCENE_4 bins, picks all five barcoded products one at a time (accumulating in
// the trolley), then parks beside Pack. The three order placeholders migrate
// Order Pool -> Pack; each product then moves a short local distance from the
// parked trolley into the order it belongs to. Scene 5 ENDS at Pack staging —
// nothing is verified / sealed / labelled / parcelled here.
// Continues directly from the settled end of SCENE_4 (five barcoded products in
// five Inventory bins). All coords are actor-overlay 960x648 units.
// ---------------------------------------------------------------------------

export const SCENE5_TROLLEY_PICK = {
  productScale: SCENE3_PRODUCT_ROUTE.productScale,
  /** The five SCENE_4 Inventory bins, carried forward unchanged. Pick order = array order. */
  bins: SCENE4_PUTAWAY.bins,
  /**
   * The one picking trolley (a shallow warehouse tote on a wheeled base). Drawn
   * at `entry` (just left of the Inventory zone — the operational way in) with
   * local basket / wheel / slot geometry. The five slots are where picked
   * products sit while carried.
   */
  trolley: {
    entry: { x: 498, y: 126 },
    basket: { x: -20, y: -13, w: 44, h: 24 },
    rail: { x: -20, y: -19, w: 3, h: 30 },
    wheels: [ { x: -12, y: 13 }, { x: 14, y: 13 } ],
    slots: [
      { x: -15, y: -9 },
      { x: -3, y: -9 },
      { x: 9, y: -9 },
      { x: -9, y: 3 },
      { x: 3, y: 3 },
    ],
  },
  /**
   * Trolley route waypoints — a serpentine (not one straight diagonal) through
   * the real bin positions: enter -> A-01 -> across to B-01 -> back-left to
   * C-01 -> across to D-02 -> down to E-02 -> exit toward Pack -> park beside
   * Pack. Never routes through Receive / Stow / barcode gate / Orders /
   * Outbound.
   */
  route: {
    enter: { x: 540, y: 138 },
    stop1: { x: 556, y: 156 },
    stop2: { x: 686, y: 184 },
    stop3: { x: 600, y: 240 },
    stop4: { x: 734, y: 272 },
    stop5: { x: 644, y: 330 },
    toPack: { x: 742, y: 352 },
    park: { x: 786, y: 300 },
  },
  /** Three minimal order cards inside [data-zone="orders"] (plane 930,80,120x130). */
  orderCards: [
    { orderId: 'order-1', label: 'ORDER 1', x: 816, y: 88, w: 96, h: 30 },
    { orderId: 'order-2', label: 'ORDER 2', x: 816, y: 123, w: 96, h: 30 },
    { orderId: 'order-3', label: 'ORDER 3', x: 816, y: 158, w: 96, h: 30 },
  ],
  /** Where each order card comes to rest once migrated into [data-zone="pack"] staging. */
  orderPackSlots: [
    { orderId: 'order-1', x: 820, y: 250 },
    { orderId: 'order-2', x: 820, y: 296 },
    { orderId: 'order-3', x: 820, y: 342 },
  ],
  /** Final product positions at Pack — grouped on their order's Pack staging card. */
  packCollection: {
    bottle: { x: 856, y: 262 },
    pouch: { x: 878, y: 262 },
    box: { x: 866, y: 308 },
    carton: { x: 856, y: 354 },
    jar: { x: 878, y: 354 },
  },
} as const;

/**
 * Per-product pick sequence, in SCENE5_TROLLEY_PICK.bins order. pickIdx /
 * transferIdx index into SCENE5_PHASES. routeStop is the trolley waypoint the
 * product is picked at. Allocation is fixed:
 * bottle+pouch -> order-1, box -> order-2, carton+jar -> order-3.
 */
export const SCENE5_PICK_SEQUENCE = [
  { productId: 'bottle', orderId: 'order-1', pickIdx: 3, transferIdx: 11, routeStop: 'stop1' },
  { productId: 'pouch', orderId: 'order-1', pickIdx: 4, transferIdx: 12, routeStop: 'stop2' },
  { productId: 'box', orderId: 'order-2', pickIdx: 5, transferIdx: 13, routeStop: 'stop3' },
  { productId: 'carton', orderId: 'order-3', pickIdx: 6, transferIdx: 14, routeStop: 'stop4' },
  { productId: 'jar', orderId: 'order-3', pickIdx: 7, transferIdx: 15, routeStop: 'stop5' },
] as const;

/** The three orders and their exact product allocation. */
export const SCENE5_ORDERS = [
  { orderId: 'order-1', label: 'ORDER 1', products: ['bottle', 'pouch'] },
  { orderId: 'order-2', label: 'ORDER 2', products: ['box'] },
  { orderId: 'order-3', label: 'ORDER 3', products: ['carton', 'jar'] },
] as const;

/**
 * SCENE_5 phase timeline — fractions of the canonical SCENE_5 duration. One
 * Scene-5-local timeline. Kept in sync with the CSS @keyframes percentages
 * generated in WorkflowFilm.
 */
export const SCENE5_PHASES = [
  'pool-establish',   // 0  three orders appear in the Order Pool, waiting
  'orders-released',  // 1  three orders -> released
  'trolley-enter',    // 2  trolley travels from the entry into the Inventory area
  'pick-bottle',      // 3  trolley at A-01: bottle picked, A-01 empty
  'pick-pouch',       // 4  trolley at B-01: pouch picked
  'pick-box',         // 5  trolley at C-01: box picked
  'pick-carton',      // 6  trolley at D-02: carton picked
  'pick-jar',         // 7  trolley at E-02: jar picked (all bins empty, trolley full)
  'trolley-to-pack',  // 8  trolley exits Inventory, travels toward Pack
  'trolley-parked',   // 9  trolley parked beside Pack
  'orders-to-pack',   // 10 the three order placeholders have migrated to Pack staging
  'transfer-bottle',  // 11 bottle moves trolley -> order-1
  'transfer-pouch',   // 12 pouch  moves trolley -> order-1
  'transfer-box',     // 13 box    moves trolley -> order-2
  'transfer-carton',  // 14 carton moves trolley -> order-3
  'transfer-jar',     // 15 jar    moves trolley -> order-3
  'settled',          // 16 Pack staging settled
] as const;
export const SCENE5_PHASE_THRESHOLDS = [
  0.00, 0.06, 0.10,
  0.17, 0.27, 0.37, 0.47, 0.57,
  0.66, 0.74, 0.78,
  0.82, 0.85, 0.88, 0.91, 0.94,
  0.97,
] as const;

// ---------------------------------------------------------------------------
// SCENE_6 actors (verify -> pack -> label): each of the three orders staged at
// its Pack station from the settled end of SCENE_5 is verified in turn, its
// barcoded products are packed into one shipping carton, the carton closes, and
// a small shipping label appears. Three labelled parcels remain at the Pack
// stations — nothing moves to Outbound. All coords are actor-overlay 960x648
// units, carried forward from the SCENE_5 Pack staging positions.
// ---------------------------------------------------------------------------

export const SCENE6_PACK_LABEL = {
  productScale: SCENE3_PRODUCT_ROUTE.productScale,
  /** Trolley carried over from SCENE_5 — parked beside Pack, empty and subdued. */
  trolley: SCENE5_TROLLEY_PICK.trolley,
  trolleyPark: SCENE5_TROLLEY_PICK.route.park,
  /**
   * The three real Pack stations (landing [data-zone="pack"] shelves, plane
   * 930,250,120x190). Each holds one order's card, one shipping carton, one
   * shipping label. `card` / `products` positions are the SCENE_5 Pack-staging
   * rest positions carried forward unchanged.
   */
  stations: [
    {
      stationId: 'pack-01', orderId: 'order-1', label: 'ORDER 1',
      card: { x: 816, y: 250, w: 96, h: 30 },
      carton: { x: 874, y: 256 },
      labelPlate: { x: 866, y: 242 },
      products: [
        { productId: 'bottle', x: 858, y: 262 },
        { productId: 'pouch', x: 880, y: 262 },
      ],
    },
    {
      stationId: 'pack-02', orderId: 'order-2', label: 'ORDER 2',
      card: { x: 816, y: 296, w: 96, h: 30 },
      carton: { x: 874, y: 302 },
      labelPlate: { x: 866, y: 288 },
      products: [
        { productId: 'box', x: 869, y: 308 },
      ],
    },
    {
      stationId: 'pack-03', orderId: 'order-3', label: 'ORDER 3',
      card: { x: 816, y: 342, w: 96, h: 30 },
      carton: { x: 874, y: 348 },
      labelPlate: { x: 866, y: 334 },
      products: [
        { productId: 'carton', x: 858, y: 354 },
        { productId: 'jar', x: 880, y: 354 },
      ],
    },
  ],
  /** One shipping carton per order — a minimal 2.5D box. `scaleY` closes it. */
  cartonBox: { x: -11, y: -2, w: 18, d: 5, h: 13 },
  /** Small shipping-label plate on the closed parcel (no readable detail). */
  labelSize: { w: 15, h: 11 },
} as const;

/**
 * SCENE_6 phase timeline — fractions of the canonical SCENE_6 duration. One
 * order verifies / packs / labels at a time, in order 1 -> 2 -> 3. Kept in sync
 * with the CSS transition percentages generated in WorkflowFilm.
 */
export const SCENE6_PHASES = [
  'establish',      // 0  three orders + their products staged at Pack 01/02/03
  'order1-verify',  // 1  Pack 01: verify bottle + pouch -> green confirm
  'order1-pack',    // 2  bottle + pouch enter one carton; carton closes
  'order1-label',   // 3  carton closed; shipping label appears
  'order2-verify',  // 4  Pack 02: verify box -> green confirm
  'order2-pack',    // 5  box enters one carton; carton closes
  'order2-label',   // 6  carton closed; shipping label appears
  'order3-verify',  // 7  Pack 03: verify carton + jar -> green confirm
  'order3-pack',    // 8  carton + jar enter one carton; carton closes
  'order3-label',   // 9  carton closed; shipping label appears
  'settled',        // 10 three labelled parcels at Pack 01 / 02 / 03
] as const;
export const SCENE6_PHASE_THRESHOLDS = [
  0.00,
  0.10, 0.18, 0.26,
  0.33, 0.44, 0.52,
  0.58, 0.70, 0.80,
  0.90,
] as const;

// ---------------------------------------------------------------------------
// SCENE_7 actors (ship / dispatch): the three SCENE_6 labelled parcels leave
// their Pack stations, stack onto ONE outbound pallet at the Shipping Dock
// ([data-zone="outbound"]), an outbound truck arrives from the exterior right
// lane and parks parallel to the right wall, the whole pallet loads into the
// truck as one unit, and the truck departs carrying everything. All coords are
// actor-overlay 960x648 units, carried forward from the SCENE_6 Pack positions.
// ---------------------------------------------------------------------------

export const SCENE7_SHIP_DISPATCH = {
  cartonBox: SCENE6_PACK_LABEL.cartonBox,
  labelSize: SCENE6_PACK_LABEL.labelSize,
  /** Trolley carried over from SCENE_5/6 — parked beside Pack, empty and subdued. */
  trolley: SCENE6_PACK_LABEL.trolley,
  trolleyPark: SCENE6_PACK_LABEL.trolleyPark,
  /** Same three labelled parcels from SCENE_6 (packPos = SCENE_6 carton centre). */
  parcels: [
    { orderId: 'order-1', products: ['bottle', 'pouch'], packPos: { x: 874, y: 256 } },
    { orderId: 'order-2', products: ['box'], packPos: { x: 874, y: 302 } },
    { orderId: 'order-3', products: ['carton', 'jar'], packPos: { x: 874, y: 348 } },
  ],
  /**
   * One outbound pallet staged inside [data-zone="outbound"] (plane
   * 880,510,170x140). Reuses the inbound-pallet base language; carries the three
   * parcels (not five product cartons). It moves dock -> truck cargo -> off the
   * exterior right lane, as one unit.
   */
  pallet: {
    dock: { x: 826, y: 548 },
    truckCargo: { x: 930, y: 520 },
    departed: { x: 1010, y: 720 },
    base: { x: -17, y: -4, w: 34, h: 10 },
    slots: [
      { x: -12, y: -7 },
      { x: 0, y: -7 },
      { x: -6, y: 3 },
    ],
  },
  /**
   * Outbound truck — same visual vocabulary as INBOUND_TRUCK, a NEW instance
   * (the inbound actor is not moved). Parked in the far-right exterior lane,
   * long axis vertical = parallel to the right warehouse wall, immediately
   * adjacent to the Shipping Dock, outside the warehouse footprint, not
   * overlapping Pack / Outbound. Arrives from below (exterior) and departs the
   * same way.
   */
  truck: {
    width: 46,
    height: 116,
    parked: { x: 916, y: 486 },
    entryOffsetY: 120,
    departOffsetY: 150,
    trailer: { x: 6, y: 14, w: 32, h: 64 },
    detailBars: [
      { x: 11, y: 24, w: 24, h: 9 },
      { x: 14, y: 38, w: 18, h: 7 },
    ],
    cab: { x: 10, y: 84, w: 26, h: 16 },
    wheels: [
      { x: 15, y: 100 },
      { x: 27, y: 100 },
    ],
  },
} as const;

/**
 * SCENE_7 phase timeline — fractions of the canonical SCENE_7 duration. One
 * Scene-7-local timeline. Kept in sync with the CSS @keyframes percentages
 * generated in WorkflowFilm.
 */
export const SCENE7_PHASES = [
  'establish',       // 0  three labelled parcels at Pack; dock empty; truck absent
  'parcels-to-dock', // 1  the three parcels move Pack -> Shipping Dock
  'pallet-building',  // 2  parcels settle onto ONE pallet, one at a time
  'truck-arriving',   // 3  outbound truck approaches up the exterior right lane
  'truck-parked',     // 4  truck parked parallel to the right wall
  'loading',          // 5  the whole pallet moves Shipping Dock -> truck cargo
  'loaded',           // 6  pallet inside the truck; brief green load-confirm cue
  'departing',        // 7  truck leaves down the same exterior lane with the load
  'settled',          // 8  truck / pallet / parcels gone; dock clear
] as const;
export const SCENE7_PHASE_THRESHOLDS = [
  0.00, 0.06, 0.28, 0.42,
  0.53, 0.59, 0.70, 0.75,
  0.94,
] as const;

// ---------------------------------------------------------------------------
// SCENE_1 actors (PO at the PO desk + inbound truck arrival)
// ---------------------------------------------------------------------------

/**
 * The actor overlay <svg> uses viewBox "0 0 960 648" stretched
 * (preserveAspectRatio="none") onto the 1100x700 plane. Convert plane coords to
 * overlay user units with these factors.
 */
export const ACTOR_OVERLAY_VIEWBOX = { WIDTH: 960, HEIGHT: 648 } as const;
export const PLANE_TO_OVERLAY_X = ACTOR_OVERLAY_VIEWBOX.WIDTH / WAREHOUSE_PLANE.WIDTH;
export const PLANE_TO_OVERLAY_Y = ACTOR_OVERLAY_VIEWBOX.HEIGHT / WAREHOUSE_PLANE.HEIGHT;

/** PO card top-left in plane coords, sitting on [data-zone="admin"] ("PO desk", 70,470,120x160). */
export const SCENE1_PO_DESK_ANCHOR = { x: 72, y: 484 } as const;
export const SCENE1_PO_CARD = { width: 100, height: 56 } as const;

/**
 * Minimal inbound truck — a DOM actor on the plane, adapted from the landing
 * arrival bay (packages/landing-page/index.html lines 836-843). All values are
 * plane coords. Parked in the yard lane beside [data-zone="dock"] ("Inbound
 * dock", 70,90,130x200), long axis parallel to the dock's left wall. Enters from
 * the top side of the plane (negative y) and settles once.
 */
/**
 * SCENE_1 choreography split (display-only, not coupled to backend sync).
 * First fraction of the scene = PO-1048 is created at the PO desk.
 * Remaining tail = the inbound truck enters from the top side and parks.
 */
export const SCENE1_PO_CREATE_FRACTION = 0.75;

export const INBOUND_TRUCK = {
  width: 58,
  height: 126,
  parked: { left: 6, top: 96 },
  entryOffsetY: -240,
  trailer: { left: 10, top: 16, width: 38, height: 78 },
  detailBars: [
    { left: 14, top: 28, width: 30, height: 10 },
    { left: 18, top: 44, width: 22, height: 8 },
  ],
  cab: { left: 14, top: 100, width: 30, height: 18 },
  wheels: [
    { left: 19, top: 116 },
    { left: 31, top: 116 },
  ],
} as const;
