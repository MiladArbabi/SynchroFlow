export const ACTIVATION_TIMING = {
  MIN_FIRST_RUN_DWELL_MS: 9000,
  MAX_POST_SYNC_RESOLVE_MS: 1800,
  COMPLETION_TRANSITION_MS: 900,
  VERY_LONG_THRESHOLD_MS: 45000,
  SCENE_NATURAL_SETTLE_MS: 900,
} as const;

export const ACTIVATION_LAYOUT = {
  LEFT_PANEL_MIN_WIDTH: 320,
  RIGHT_FILM_MIN_WIDTH: 360,
  DESKTOP_LEFT_PERCENT: 44,
  DESKTOP_RIGHT_PERCENT: 56,
} as const;

export const ACTIVATION_COLORS = {
  workflowAction: 'var(--accent)',
  workflowActionHover: 'var(--accent-hover)',
  completion: '#4CAF7A',
  neutralBg: 'var(--bg)',
  neutralBg2: 'var(--bg-2)',
  neutralBg3: 'var(--bg-3)',
  textPrimary: 'var(--ink)',
  textSecondary: 'var(--ink-2)',
  textMuted: 'var(--ink-3)',
  rule: 'var(--rule)',
} as const;

export const ACTIVATION_EASING = {
  standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
  exit: 'cubic-bezier(0.2, 0, 0, 1)',
} as const;

export type WorkflowTraceNode =
  | 'PO'
  | 'RECEIVED'
  | 'LOCATION'
  | 'ORDER'
  | 'BATCH'
  | 'PICK'
  | 'PACK'
  | 'SHIP';

export const WORKFLOW_TRACE_NODE_ORDER: WorkflowTraceNode[] = [
  'PO',
  'RECEIVED',
  'LOCATION',
  'ORDER',
  'BATCH',
  'PICK',
  'PACK',
  'SHIP',
] as const;

export type WorkflowSceneId =
  | 'SCENE_1'
  | 'SCENE_2'
  | 'SCENE_3'
  | 'SCENE_4'
  | 'SCENE_5'
  | 'SCENE_6'
  | 'SCENE_7';

export interface WorkflowSceneDefinition {
  id: WorkflowSceneId;
  stepNumber: number;
  label: string;
  displayLines: string[];
  fullSemanticCopy: string;
  semanticFlow: string[];
  traceNodes: WorkflowTraceNode[];
  durationMs: number;
}

export const WORKFLOW_SCENES: WorkflowSceneDefinition[] = [
  {
    id: 'SCENE_1',
    stepNumber: 1,
    label: 'Plan',
    displayLines: ['Create the PO.', 'Know what stock is coming.'],
    fullSemanticCopy: 'Create the PO so expected stock is known before anything arrives. The inbound truck then arrives at the inbound dock.',
    semanticFlow: ['purchase order', 'expected stock', 'inbound intent'],
    traceNodes: ['PO'],
    durationMs: 3000,
  },
  {
    id: 'SCENE_2',
    stepNumber: 2,
    label: 'Receive',
    displayLines: ['Receive against the PO.'],
    fullSemanticCopy: 'Receive against the PO. The inbound truck is unloaded, the pallet moves through the inbound dock to Receive, and the goods are unpacked and confirmed.',
    semanticFlow: ['truck unloaded', 'pallet to dock', 'pallet to receive', 'goods unpacked'],
    traceNodes: ['PO', 'RECEIVED'],
    durationMs: 3200,
  },
  {
    id: 'SCENE_3',
    stepNumber: 3,
    label: 'Barcode',
    displayLines: ['Give each product a LaSyncro barcode.', 'Queue it for put away.'],
    fullSemanticCopy: 'Give each product a LaSyncro barcode, then queue it for put away. Each received product passes the barcode gate, receives a LaSyncro barcode, and lines up in the stow queue.',
    semanticFlow: ['received stock', 'barcode gate', 'lasyncro barcode', 'stow queue'],
    traceNodes: ['PO', 'RECEIVED', 'LOCATION'],
    durationMs: 3200,
  },
  {
    id: 'SCENE_4',
    stepNumber: 4,
    label: 'Put away',
    displayLines: ['Place each barcoded product in the correct bin.'],
    fullSemanticCopy: 'Place each barcoded product in the correct bin. Each barcoded product leaves the stow queue and moves one at a time to its assigned inventory bin, which shows a brief confirmation before the next product follows.',
    semanticFlow: ['barcoded products', 'stow queue', 'inventory bin', 'placement confirmed'],
    traceNodes: ['PO', 'RECEIVED', 'LOCATION', 'ORDER', 'BATCH'],
    durationMs: 4200,
  },
  {
    id: 'SCENE_5',
    stepNumber: 5,
    label: 'Pick',
    displayLines: ['Release orders.', 'Pick their items and move them to pack.'],
    fullSemanticCopy: 'Release orders, then pick their items and move them to pack. Three orders are released in the order pool; one picking trolley travels through the inventory bins, collecting all five barcoded products one at a time, then parks beside pack, where each product moves into the order it belongs to.',
    semanticFlow: ['orders released', 'picking trolley', 'inventory pick', 'staged at pack'],
    traceNodes: ['PO', 'RECEIVED', 'LOCATION', 'ORDER', 'BATCH', 'PICK'],
    durationMs: 4000,
  },
  {
    id: 'SCENE_6',
    stepNumber: 6,
    label: 'Pack',
    displayLines: ['Verify each order.', 'Pack it and create the shipping label.'],
    fullSemanticCopy: 'Verify each order, then pack it and create the shipping label. Each order is verified in turn at its Pack station, its barcoded products are packed into one shipping carton, the carton closes, and a shipping label appears; three labelled parcels remain at the Pack stations.',
    semanticFlow: ['picked work', 'verification', 'parcel', 'label'],
    traceNodes: ['PO', 'RECEIVED', 'LOCATION', 'ORDER', 'BATCH', 'PICK', 'PACK'],
    durationMs: 3400,
  },
  {
    id: 'SCENE_7',
    stepNumber: 7,
    label: 'Ship',
    displayLines: ['Move packed orders to the shipping dock.', 'Load the truck and send them out.'],
    fullSemanticCopy: 'Move packed orders to the shipping dock, load the truck and send them out. The three labelled parcels leave the pack stations and gather onto one pallet at the shipping dock; an outbound truck arrives and parks alongside the dock; the whole pallet is loaded into the truck and the truck leaves carrying every order.',
    semanticFlow: ['labelled parcels', 'shipping dock', 'outbound pallet', 'truck departs'],
    traceNodes: ['PO', 'RECEIVED', 'LOCATION', 'ORDER', 'BATCH', 'PICK', 'PACK', 'SHIP'],
    durationMs: 3800,
  },
] as const;

export const WORKFLOW_CLOSING_LINES = [
  'Clear tasks.',
  'Clear ownership.',
  'Full traceability.',
] as const;

export const SCENE_4_SEMANTICS = WORKFLOW_SCENES[3].semanticFlow;
export const SCENE_5_SEMANTICS = WORKFLOW_SCENES[4].semanticFlow;
export const SCENE_6_SEMANTICS = WORKFLOW_SCENES[5].semanticFlow;
export const SCENE_7_TRACE_NODES = WORKFLOW_SCENES[6].traceNodes;

export const WORKFLOW_SCENE_IDS = WORKFLOW_SCENES.map((scene) => scene.id);

export function getWorkflowSceneById(id: WorkflowSceneId): WorkflowSceneDefinition {
  return WORKFLOW_SCENES.find((scene) => scene.id === id) ?? WORKFLOW_SCENES[0];
}

export function getWorkflowTraceNodesForScene(id: WorkflowSceneId | null): WorkflowTraceNode[] {
  if (!id) return WORKFLOW_TRACE_NODE_ORDER;
  return getWorkflowSceneById(id).traceNodes;
}
