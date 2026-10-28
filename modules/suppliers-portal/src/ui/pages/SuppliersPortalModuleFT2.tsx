// modules/suppliers-portal/src/ui/pages/SuppliersPortalModuleFT2.tsx
import { Fragment, useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box,
  Paper,
  Typography,
  Alert,
  Chip,
  Divider,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  ListSubheader,
  Menu,
  MenuItem,
  IconButton,
  Popover,
  Tooltip,
} from '@mui/material';
import { Truck, Star, Clock, ChevronDown, ChevronLeft, Package, CheckCircle, XCircle, Plus, Trash2, MoreHorizontal } from 'lucide-react';
import { 
  ModuleErrorBoundary, 
  ModuleLoadingSkeleton, 
  SpotlightCoachMark,
  EntityDetailModal,
  PulseCard
 } from '@lasyncro/shared/ui';
/**
 * SUPPLIERS PORTAL MODULE — FT2 SURFACE
 * ---------------------------------------
 * Displays POs (primary) and suppliers list (secondary/bottom).
 *
 * Layout:
 *   1. Open POs — accordion per PO, line items fetched on expand
 *   2. Suppliers — accordion list at bottom
 *
 * Create PO flow:
 *   - Supplier selector with inline "Add new supplier" option
 *   - Dynamic line items (description, qty, optional unit cost)
 *   - Expected delivery date + notes
 *
 * All API callbacks injected via props — module stays decoupled
 * from apps/frontend HTTP layer.
 */

export type PurchaseOrderStatus =
  | 'draft' | 'ordered' | 'confirmed'
  | 'in_production' | 'shipped' | 'partially_received' | 'received' | 'cancelled';

export type PurchaseOrder = {
  id: string;
  po_number?: number | null;
  supplier_name: string;
  supplier_contact_email: string | null;
  supplier_contact_name: string | null;
  supplier_moq: number | null;
  supplier_on_time_rate: number | null;
  supplier_fill_rate: number | null;
  status: PurchaseOrderStatus;
  expected_delivery_date: string | null;
  actual_delivery_date: string | null;
  line_items_count: number;
  total_units_ordered: number;
  total_units_received: number;
  notes: string | null;
  document_url: string | null;
  created_at: string;
  first_line_description: string | null;
  receive_job_id?: string | null;
  receive_status?: string | null;
  receive_assigned_operator_id?: number | null;
  receive_assigned_operator_name?: string | null;
};

const formatPoDisplay = (po: Pick<PurchaseOrder, 'po_number'>) =>
  po.po_number == null ? 'PO reference unavailable' : `PO-${po.po_number}`;

export type PoLineItem = {
  id: string;
  lasyncro_variant_id: string | null;
  description: string;
  quantity_ordered: number;
  quantity_received: number;
  unit_cost_cents: number | null;
  sku: string | null;
  image_url: string | null;
  product_title: string | null;
};

export type Supplier = {
  id: number;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  on_time_rate: number | null;
  fill_rate: number | null;
  defect_rate: number | null;
  total_pos: number;
  active: boolean;
  moq: number | null;
  lead_time_days: number | null;
  open_po_count: number;
};

export type CreateSupplierInput = {
  name: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  moq?: number;
  lead_time_days?: number;
};

type CreatePoFields = {
  expected_delivery_date?: string;
  notes?: string;
  line_items: {
    description: string;
    quantity_ordered: number;
    unit_cost_cents?: number;
    lasyncro_variant_id?: string | null;
  }[];
};

/**
 * GH-1262 S1 R10-A: an existing supplier_id XOR inline new_supplier details.
 * Inline details travel with the PO so the server creates both atomically.
 */
export type CreatePoInput =
  | (CreatePoFields & { supplier_id: number; new_supplier?: never })
  | (CreatePoFields & { new_supplier: CreateSupplierInput; supplier_id?: never });

export type SourcingRecommendation = {
  id: number;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  on_time_rate: string | null;
  fill_rate: string | null;
  defect_rate: string | null;
  avg_delivery_days: string | null;
  moq: number | null;
  lead_time_days: number | null;
  score: number;
  /** SRC-06: units already queued for this supplier across ALL variants. */
  pooled_qty: number;
  /**
   * Units still needed to reach this supplier's minimum once this variant is
   * queued too. 0 means queueing completes it, or they have no minimum.
   * Replaced `exceeds_moq`, which compressed this into a verdict and caused
   * the UI to hide the queue button from exactly the suppliers that need it.
   */
  units_to_moq: number;
  // §7.8 preference fields
  is_preferred: boolean;
  preference_tier: 1 | 2 | null;
  preference_priority: number | null;
  preference_scope: string | null;
  preference_note: string | null;
};

/**
 * SRC-03: the endpoint returns the derived shortfall alongside the ranked
 * candidates. It is a property of the VARIANT, not of any one supplier, so it
 * sits beside the list rather than inside each entry.
 */
export type SourcingResult = {
  recommendations: SourcingRecommendation[];
  /**
   * SOURCING-UX-COGNITIVE-01 Slice 1A — TARGETED IDENTITY.
   * The page could previously never name what it was sourcing: a merchant
   * arriving from a blocked order saw ranked suppliers and a bare number.
   * Nullable because a variant may legitimately carry no image or SKU.
   */
  image_url?: string | null;
  product_title?: string | null;
  variant_title?: string | null;
  sku?: string | null;
  /**
   * Slice 1A — PURCHASING TRUTH. `short_now` ignores anything already
   * bought; `still_to_source` is what actually remains to buy. Kept
   * distinct so a merchant with stock inbound is not told to re-order it.
   */
  open_demand?: number;
  available?: number;
  committed_inbound?: number;
  short_now?: number;
  still_to_source?: number;
  blocking_orders?: Array<{
    order_id: string;
    external_order_id: string | null;
    units: number;
  }>;
  /** Echoed only when it is genuinely one of this variant's blocking orders. */
  originating_order_id?: string | null;
  /**
   * Slice 1B — PURCHASING WORKFLOW. What the merchant has already STARTED
   * buying, as distinct from what is already coming. Queue intent and draft PO
   * work never reduce `still_to_source`; they exist so the surface can stop
   * offering to start the same purchase a second time.
   *
   *   in_purchasing = pending_queue_qty + draft_po_qty
   *   unplanned     = max(0, still_to_source - in_purchasing)
   */
  pending_queue_qty?: number;
  draft_po_qty?: number;
  in_purchasing?: number;
  unplanned?: number;
  shortfall: number;
  shortfall_basis: { demand: number; available: number };
  /**
   * SRC-12: queue_qty is what the input prefills with — the preventive
   * suggestion when one exists, floored at the reactive shortfall so we never
   * propose ordering less than customers are already waiting for.
   * quantity_basis names WHICH number it is; it is never a silent swap.
   */
  queue_qty: number;
  quantity_basis:
    | 'preventive'
    | 'reactive'
    | 'reactive_no_lead_time'
    | 'reactive_no_history'
    | 'planning_data_required'
    | 'no_signal';
  suggested_reorder_qty: number | null;
  planning_context: {
    demand_confidence: 'high' | 'medium' | 'low' | 'none';
    velocity_window_days: 30 | 90 | 180;
    days_of_stock_remaining: number | null;
    reorder_urgency: string;
    supplier_lead_time_days: number | null;
    /** lead time + safety + purchasing cycle — the span the suggestion covers */
    target_coverage_days: number | null;
  } | null;
};

/**
 * SOURCING-UX-COGNITIVE-01 Slice 2 — UNIFIED SOURCING WORKLIST.
 * The generic (no-variantId) portfolio view's set-wise read model. Distinct
 * from SourcingResult above, which is the per-variant TARGETED payload.
 */
export type SourcingWorklistCategory =
  | 'needs_supplier'
  | 'needs_purchase'
  | 'in_purchasing'
  | 'covered_inbound'
  | 'plan_ahead';

export type SourcingWorklistParams = {
  q?: string;
  category?: SourcingWorklistCategory | 'all';
  supplier_readiness?: 'ready' | 'needs_supplier' | 'no_history';
  purchasing_stage?: 'not_started' | 'queued' | 'draft' | 'committed';
  coverage?: 'short' | 'covered_inbound';
  sort?: 'action_priority' | 'oldest_demand' | 'still_to_source' | 'stockout_soonest' | 'product_az';
  page?: number;
  page_size?: number;
};

export type SourcingWorklistItem = {
  lasyncro_variant_id: string;
  product_title: string | null;
  variant_title: string | null;
  sku: string | null;
  image_url: string | null;
  category: SourcingWorklistCategory;
  open_demand: number;
  blocked_order_count: number;
  oldest_open_order_at: string | null;
  available: number;
  committed_inbound: number;
  short_now: number;
  still_to_source: number;
  pending_queue_qty: number;
  draft_po_qty: number;
  in_purchasing: number;
  unplanned: number;
  has_usable_supplier: boolean;
  has_preference: boolean;
  has_supplier_history: boolean;
  planning_urgency: string | null;
  days_of_stock_remaining: number | null;
  suggested_reorder_qty: number | null;
};

export type SourcingWorklistSummary = {
  needs_supplier: number;
  needs_purchase: number;
  in_purchasing: number;
  covered_inbound: number;
  plan_ahead: number;
};

export type SourcingWorklistResult = {
  summary: SourcingWorklistSummary;
  items: SourcingWorklistItem[];
  page: number;
  page_size: number;
  total: number;
};

export type PreferenceRow = {
  id: string;
  supplier_id: number;
  supplier_name: string;
  scope_type: 'variant' | 'product' | 'product_type';
  scope_id: string;
  priority: number;
  note: string | null;
  created_at: string;
  updated_at: string;
};

// §8 MOQ Accumulation System — sourcing-recommendation-playbook.md §8
export type ReorderRequest = {
  id: string;
  lasyncro_variant_id: string;
  sku: string | null;
  title: string | null;
  qty_requested: number;
  source: 'alert' | 'manual';
  created_at: string;
};

export type SupplierAccumulation = {
  supplier_id: number;
  supplier_name: string;
  moq: number | null;
  /** SRC-01b: null means the supplier has no delivery time set — hard gate G3. */
  lead_time_days: number | null;
  total_qty: number;
  moq_met: boolean;
  all_lines_have_sku: boolean;
  /** SRC-01a gates, mirrored from the server — never recomputed client-side. */
  gates: {
    moq_met: boolean;
    lead_time_set: boolean;
    all_lines_have_sku: boolean;
  };
  /** True only when every gate passes. Convert re-checks server-side regardless. */
  po_ready: boolean;
  requests: ReorderRequest[];
};

export type SuppliersPortalData = {
  purchase_orders: PurchaseOrder[];
  suppliers: Supplier[];
  never_ordered: { lasyncro_variant_id: string; sku: string | null; title: string; product_title: string | null; product_id: string | null; product_type: string | null; has_sku: boolean }[];
  never_ordered_count: number;
} | null;

export type ReceiveAssignableOperator = {
  id: number;
  name: string;
  role?: string;
};

export type ReceiveAssigneesStatus = 'loading' | 'error' | 'ready' | 'unavailable';

export type SuppliersPortalPageProps = {
  /** Which half of the Purchasing surface to render. Tab routing lives in the ft2-pages wrapper, not here. */
  view: 'pos' | 'suppliers' | 'sourcing';
  data: SuppliersPortalData;
  isLoading: boolean;
  isError: boolean;
  onRefresh: () => void;
  onFetchLineItems: (poId: string) => Promise<PoLineItem[]>;
  onUpdatePoStatus: (poId: string, status: PurchaseOrderStatus, actualDeliveryDate?: string) => Promise<void>;
  onCreateSupplier: (input: CreateSupplierInput) => Promise<Supplier>;
  onUpdateSupplier: (id: number, input: CreateSupplierInput) => Promise<Supplier>;
  onDeleteSupplier: (id: number) => Promise<void>;
  /**
   * GH-1262 S1 R10-B/C: `idempotencyKey` identifies one logical create
   * operation (owned by CreatePoDialog) and travels as the Idempotency-Key
   * header — never in the request body.
   */
  onCreatePo: (input: CreatePoInput, options: { idempotencyKey: string }) => Promise<void>;
  /** Creates dispatched Receive work for a shipped PO. */
  onCreateReceiveJob: (
    poId: string,
    input: { assigned_operator_id: number }
  ) => Promise<{ receive_job_id: string }>;
  /**
   * GH-1143 RECEIVE-REASSIGN-UI-01 — reassigns an EXISTING pending/unstarted
   * Receive job to a different operator. Distinct from onCreateReceiveJob:
   * this is the explicit owner/admin management path and must never be
   * confused with initial dispatch/creation.
   */
  onReassignReceiveJob?: (
    jobId: string,
    targetOperatorId: number
  ) => Promise<void>;
  /** Candidates already filtered by the app wrapper for Receive assignment. */
  teamAssignableOperators?: ReceiveAssignableOperator[];
  /**
   * WS-UX-01 S2 — load state of teamAssignableOperators. Only 'ready' is proof
   * of who is eligible; 'unavailable' means the viewer may not assign.
   */
  receiveAssigneesStatus?: ReceiveAssigneesStatus;
  onRetryReceiveAssignees?: () => void;
  /** WS-UX-01 S2 — owner/admin dispatch authority (receive-job:assign). */
  canManageReceiveAssignment?: boolean;
  /**
   * WS-UX-01 S2 — awaitable, authoritative PO re-read used to reconcile
   * assignment mutations. Must reject when the read fails or is unusable.
   * Without it, assignment outcomes cannot be confirmed and fail closed.
   */
  onReconcilePurchaseOrders?: () => Promise<PurchaseOrder[]>;
  /** WS-UX-01 S3 — canonical GET /receive-jobs/:jobId for the inline brief. */
  onFetchReceiveJob?: (jobId: string) => Promise<ReceiveJobDetail>;
  /** WS-UX-01 S3 — claims exactly this job. Claim is the single start transition. */
  onClaimReceiveJob?: (jobId: string) => Promise<void>;
  /** Explicit authenticated identity. Never infer "Me" from array order. */
  currentUserId?: number | null;
  onSearchVariants: (q: string) => Promise<VariantOption[]>;
  /** Sourcing (Thread C): ranked supplier recommendations for onevariant, fetched on demand. */
  // SRC-03: neededQty removed — the server derives it. Passing it in was the
  // old `?needed=` path, which no caller ever populated.
  onFetchSourcingRecommendations: (variantId: string) => Promise<SourcingResult>;
  /**
   * SOURCING-UX-COGNITIVE-01 Slice 2: set-wise fetch for the generic
   * (no-variantId) Unified Sourcing Worklist. Never called from targeted
   * mode, and onFetchSourcingRecommendations is never called from generic
   * mode (SRC-WL-UI-14) — the two surfaces use disjoint fetches.
   */
  onFetchSourcingWorklist: (params: SourcingWorklistParams) => Promise<SourcingWorklistResult>;
  // §7.7 Preference CRUD
  onFetchPreferences: () => Promise<PreferenceRow[]>;
  onCreatePreference: (input: { supplier_id: number; scope_type: string; scope_id: string; priority?: number; note?: string }) => Promise<PreferenceRow>;
  onUpdatePreference: (id: string, input: { priority?: number; note?: string }) => Promise<PreferenceRow>;
  onDeletePreference: (id: string) => Promise<void>;
  // §8 MOQ Accumulation — sourcing-recommendation-playbook.md §8
  onFetchReorderRequests: () => Promise<SupplierAccumulation[]>;
  /**
   * OUTCOME-INV-01: `originating_order_id` and `shown_treatment_key` are
   * ATTRIBUTION PROVENANCE, both optional. They say which blocked order the
   * merchant came from and what they were shown — never what was bought, and
   * never anything about resolution. Generic sourcing sends neither.
   */
  onCreateReorderRequest: (input: {
    lasyncro_variant_id: string;
    supplier_id: number;
    qty_requested: number;
    source: 'alert' | 'manual';
    originating_order_id?: string;
    shown_treatment_key?: string;
  }) => Promise<ReorderRequest>;
  onDeleteReorderRequest: (id: string) => Promise<void>;
  /** SRC-01b: overrideMoq is the operator's explicit under-MOQ decision — the
   *  server rejects with 422 unless it is passed, and stamps it on the PO. */
  onConvertReorderRequests: (supplierId: number, overrideMoq?: boolean) => Promise<{ po_id: string }>;
  /** §8: set by page after convert survives refetch re-render — cleared by dismiss */
  lastConvertedPoId?: string | null;
  onDismissConvertedPo?: () => void;
  /** Onboarding spotlights — resolved via useSpotlight() at page level */
  spotlights?: {
    neverOrdered:   { isDismissed: boolean; dismiss: () => void };
    alertTriggered: { isDismissed: boolean; dismiss: () => void };
    accumulator:    { isDismissed: boolean; dismiss: () => void };
    poSendFlow:     { isDismissed: boolean; dismiss: () => void };
    /** GH-1109 residual: assignment vs claim/start onboarding in the Assign Receive dialog. */
    receiveDispatchAssignment?: { isDismissed: boolean; dismiss: () => void };
  };
  /** When true, auto-opens the Create PO dialog on mount */
  autoOpenCreatePo?: boolean;
  /** PO targeted by action=receive deep-link. Uses the canonical assignment dialog. */
  autoOpenReceivePoId?: string;
  /** Pre-filled line item from demand module handoff */
  prefilledLineItem?: { description: string; quantity_ordered: number; lasyncro_variant_id?: string };
};

const STATUS_CONFIG: Record<PurchaseOrderStatus, {
  label: string;
  color: 'default' | 'primary' | 'warning' | 'success' | 'error' | 'info';
}> = {
  draft:              { label: 'Draft',       color: 'default' },
  ordered:            { label: 'On the way',  color: 'info'    },
  confirmed:          { label: 'On the way',  color: 'info'    },
  in_production:      { label: 'On the way',  color: 'info'    },
  shipped:            { label: 'Arrived',     color: 'success' },
  partially_received: { label: 'Receiving',   color: 'warning' },
  received:           { label: 'Received',    color: 'success' },
  cancelled:          { label: 'Cancelled',       color: 'error'   },
};

const OPEN_STATUSES: PurchaseOrderStatus[] = [
  'draft', 'ordered', 'confirmed', 'in_production', 'shipped', 'partially_received'
];

const NEW_SUPPLIER_SENTINEL = '__new__';

/**
 * GH-1262 S1 R10-B: a cryptographically strong, unique operation key.
 * Fails closed when no secure random source exists — never Math.random or a
 * timestamp.
 */
function createIdempotencyKey(): string {
  const source = globalThis.crypto;
  if (typeof source?.randomUUID === 'function') return source.randomUUID();
  if (typeof source?.getRandomValues === 'function') {
    const bytes = source.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // RFC 4122 version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error('Secure random source unavailable');
}

const POSITIVE_INTEGER = /^[1-9]\d*$/;
const MONEY_AMOUNT = /^\d+(\.\d{1,2})?$/;
const WHOLE_NUMBER = /^-?\d+$/;
// PostgreSQL `integer` bound shared by unit_cost_cents, suppliers.moq and
// suppliers.lead_time_days (migrations 0094 / 0096).
const PG_INTEGER_MAX = 2147483647;
const PG_INTEGER_MIN = -2147483648;

/**
 * GH-1262 S1 R10 C1: a selected variant's cost replaces the line's cost.
 * null/undefined = unknown (blank); 0 = a known zero ("0"). A previous
 * variant's cost is never carried over.
 */
function variantCostText(unitCost: number | string | null | undefined): string {
  return unitCost === null || unitCost === undefined ? '' : String(unitCost);
}

/**
 * GH-1262 S1 R10 C2: blank → undefined (unknown); otherwise a non-negative
 * amount with at most two decimals whose cents are a safe integer within the
 * unit_cost_cents column. `null` = invalid.
 */
function parseUnitCostCents(text: string): number | undefined | null {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (!MONEY_AMOUNT.test(trimmed)) return null;
  const cents = Math.round(Number(trimmed) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > PG_INTEGER_MAX) return null;
  return cents;
}

/**
 * GH-1262 S1 R10 C2: optional supplier integer (moq, lead_time_days).
 * Blank → undefined (no minimum / unknown). Otherwise only the rule the
 * schema establishes: a whole number within PostgreSQL `integer`.
 * `null` = invalid.
 */
function parseOptionalSupplierInteger(text: string): number | undefined | null {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (!WHOLE_NUMBER.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < PG_INTEGER_MIN || value > PG_INTEGER_MAX) return null;
  return value;
}

// ─────────────────────────────────────────────
// CREATE PO DIALOG
// ─────────────────────────────────────────────

type LineItemDraft = {
  key: number;
  description: string;
  quantity_ordered: string;
  unit_cost_cents: string;
  lasyncro_variant_id?: string | null;
  sku?: string | null;
  product_title?: string | null;
  image_url?: string | null;
};
type VariantOption = { 
  lasyncro_variant_id: string; 
  sku: string | null; 
  title: string | null; 
  unit_cost: number | null; 
  image_url: string | null; 
  product_title: string | null
 };

function CreatePoDialog({
  open,
  suppliers,
  onClose,
  onCreatePo,
  onSearchVariants,
  prefilledLineItem,
  prefilledSupplierId,
}: {
  open: boolean;
  suppliers: Supplier[];
  onClose: () => void;
  onCreatePo: (input: CreatePoInput, options: { idempotencyKey: string }) => Promise<void>;
  /** Creates a WMS receive job for a shipped PO. Navigates operator to receive session. */
  onSearchVariants: (q: string) => Promise<VariantOption[]>;
  prefilledLineItem?: { description: string; quantity_ordered: number; lasyncro_variant_id?: string };
  /** Sourcing (Thread C): pre-select the recommended supplier when opened from Sourcing. */
  prefilledSupplierId?: number;
}) {
  const [supplierId, setSupplierId] = useState<string>(prefilledSupplierId ? String(prefilledSupplierId) : '');
  // The dialog stays mounted between openings, so the state initializer above
  // runs once — before the merchant has picked a supplier. Follow the prop.
  useEffect(() => {
    if (prefilledSupplierId) setSupplierId(String(prefilledSupplierId));
  }, [prefilledSupplierId, open]);
  const [newSupplier, setNewSupplier] = useState({ name: '', contact_name: '', contact_email: '', contact_phone: '', moq: '', lead_time_days: '' });
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([
    { key: 0, description: '', quantity_ordered: '', unit_cost_cents: '' },
  ]);
  // REPL-001: seed first line from a reorder deep-link (Demand → Order →). Qty stays editable (MOQ-aware-ready).
  //
  // SRC-ACT-UI-07: the gate was `prefilledLineItem.description` alone, so a
  // targeted Sourcing hand-off that carried a canonical variant but no
  // description seeded NOTHING — the merchant got a blank line and a quantity
  // of 1 against a real requirement. Seed whenever either a description or a
  // canonical variant is supplied, and carry the variant link through so the
  // PO line stays attached to the product it is meant to replenish.
  useEffect(() => {
    if (!prefilledLineItem) return;
    if (!prefilledLineItem.description && !prefilledLineItem.lasyncro_variant_id) return;

    setLineItems([{
      key: 0,
      description: prefilledLineItem.description,
      quantity_ordered: prefilledLineItem.quantity_ordered ? String(prefilledLineItem.quantity_ordered) : '',
      unit_cost_cents: '',
      lasyncro_variant_id: prefilledLineItem.lasyncro_variant_id ?? null,
    }]);
  }, [prefilledLineItem]);
  const [submitting, setSubmitting] = useState(false);
  // R10-B: synchronous guard — a second click can land before the
  // `submitting` re-render disables the button.
  const submittingRef = useRef(false);
  // R10-B: the in-flight logical operation. An unchanged retry reuses its key;
  // a changed normalized request, a confirmed success or an explicit close
  // starts a new one.
  const operationRef = useRef<{ key: string; fingerprint: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [variantOptions, setVariantOptions] = useState<VariantOption[]>([]);
  const [variantSearch, setVariantSearch] = useState<Record<number, string>>({});
  const [focusedOptionIndex, setFocusedOptionIndex] = useState(-1);
  // Ref for the dropdown container — used to auto-scroll focused option into view
  const dropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusedOptionIndex < 0 || !dropdownRef.current) return;
    const el = dropdownRef.current.children[focusedOptionIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusedOptionIndex]);

  let keyCounter = lineItems.length;

  const isNewSupplier = supplierId === NEW_SUPPLIER_SENTINEL;

  const addLineItem = () => {
    setLineItems((prev) => [
      ...prev,
      { key: keyCounter++, description: '', quantity_ordered: '', unit_cost_cents: '' },
    ]);
  };

  const removeLineItem = (key: number) => {
    setLineItems((prev) => prev.filter((i) => i.key !== key));
  };

  const updateLineItem = (key: number, field: keyof LineItemDraft, value: string) => {
    setLineItems((prev) =>
      prev.map((i) => (i.key === key ? { ...i, [field]: value } : i))
    );
  };

  const handleSubmit = async () => {
    if (submittingRef.current) return;
    setError(null);

    // Validate supplier
    if (!supplierId) return setError('Please select a supplier.');
    if (isNewSupplier && !newSupplier.name.trim()) return setError('New supplier name is required.');
    const newSupplierMoq = parseOptionalSupplierInteger(newSupplier.moq);
    const newSupplierLeadTime = parseOptionalSupplierInteger(newSupplier.lead_time_days);
    if (isNewSupplier && newSupplierMoq === null) return setError('MOQ must be a whole number.');
    if (isNewSupplier && newSupplierLeadTime === null) return setError('Lead time must be a whole number of days.');

    // Validate line items. Quantities must be written as whole positive
    // numbers: parseInt would silently turn "1.5" into 1 and "2abc" into 2.
    for (const item of lineItems) {
      if (!item.description.trim()) return setError('All line items need a description.');
      const qtyText = item.quantity_ordered.trim();
      if (!POSITIVE_INTEGER.test(qtyText) || !Number.isSafeInteger(Number(qtyText))) {
        return setError('All line items need a whole-number quantity (≥ 1).');
      }
      if (parseUnitCostCents(item.unit_cost_cents) === null) {
        return setError('Unit cost must be a non-negative amount with at most two decimals.');
      }
      if (!item.lasyncro_variant_id) return setError(
        `"${item.description.trim()}" is not linked to a Shopify product. Search and select it from the dropdown, or create it in Shopify first then search here.`
      );
    }

    const fields = {
      expected_delivery_date: expectedDate || undefined,
      notes: notes.trim() || undefined,
      line_items: lineItems.map((item) => ({
        description: (item.product_title ?? item.description).trim(),
        quantity_ordered: Number(item.quantity_ordered.trim()),
        // Validated above: blank stays unknown (undefined); "0" is a known zero.
        unit_cost_cents: parseUnitCostCents(item.unit_cost_cents) ?? undefined,
        lasyncro_variant_id: item.lasyncro_variant_id?.trim() || null,
      })),
    };

    // R10-A: inline supplier details travel with the PO in ONE create call.
    const input: CreatePoInput = isNewSupplier
      ? {
          ...fields,
          new_supplier: {
            name: newSupplier.name.trim(),
            contact_name: newSupplier.contact_name.trim() || undefined,
            contact_email: newSupplier.contact_email.trim() || undefined,
            contact_phone: newSupplier.contact_phone.trim() || undefined,
            moq: newSupplierMoq ?? undefined,
            lead_time_days: newSupplierLeadTime ?? undefined,
          },
        }
      : { ...fields, supplier_id: parseInt(supplierId, 10) };

    // R10-B: reuse the key only for an unchanged retry of the same request.
    const fingerprint = JSON.stringify(input);
    if (!operationRef.current || operationRef.current.fingerprint !== fingerprint) {
      try {
        operationRef.current = { key: createIdempotencyKey(), fingerprint };
      } catch {
        operationRef.current = null;
        return setError('Cannot create a purchase order safely in this browser.');
      }
    }
    const { key } = operationRef.current;

    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onCreatePo(input, { idempotencyKey: key });
      // Confirmed completion: the next submit is a new logical operation.
      operationRef.current = null;
      onClose();
    } catch (err: any) {
      // Failure keeps the operation (and the merchant's input) for a retry.
      setError(err?.response?.data?.error ?? 'Failed to create purchase order.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (submitting) return;
    // Explicit abandonment ends the logical operation.
    operationRef.current = null;
    setSupplierId('');
    setNewSupplier({ name: '', contact_name: '', contact_email: '', contact_phone: '', moq: '', lead_time_days: '' });
    setExpectedDate('');
    setNotes('');
    setLineItems([{ key: 0, description: '', quantity_ordered: '', unit_cost_cents: '' }]);
    setError(null);
    onClose();
  };

  return (
    <EntityDetailModal
      entityId={open ? 'new-purchase-order' : null}
      onClose={handleClose}
      title="New Purchase Order"
      maxWidth="md"
      footerActions={
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 1,
            flexWrap: 'wrap',
          }}
        >
          <Button
            variant="outlined"
            onClick={handleClose}
            disabled={submitting}
            sx={{
              color: 'var(--ink-3)',
              borderColor: 'var(--rule)',
              '&:hover': {
                borderColor: 'var(--rule-2)',
                bgcolor: 'var(--surface)',
              },
            }}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            onClick={() => void handleSubmit()}
            disabled={submitting}
            sx={{
              bgcolor: 'var(--accent)',
              color: 'var(--accent-ink)',
              '&:hover': {
                bgcolor: 'var(--accent)',
                opacity: 0.88,
              },
            }}
          >
            {submitting ? 'Creating…' : 'Create PO'}
          </Button>
        </Box>
      }
    >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>

          {error && <Alert severity="error">{error}</Alert>}

          {/* SUPPLIER SELECTOR */}
          <TextField
            select
            label="Supplier"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            fullWidth
            size="small"
          >
            {suppliers.filter((s) => s.active).map((s) => (
              <MenuItem key={s.id} value={String(s.id)}>{s.name}</MenuItem>
            ))}
            <MenuItem value={NEW_SUPPLIER_SENTINEL}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Plus size={14} />
                <Typography variant="body2">Add new supplier</Typography>
              </Box>
            </MenuItem>
          </TextField>

          {/* INLINE NEW SUPPLIER FORM */}
          {isNewSupplier && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
              <Typography variant="caption" fontWeight={700} color="text.secondary">NEW SUPPLIER</Typography>
              <TextField label="Name *" size="small" fullWidth value={newSupplier.name}
                onChange={(e) => setNewSupplier((p) => ({ ...p, name: e.target.value }))} />
              <TextField label="Contact name" size="small" fullWidth value={newSupplier.contact_name}
                onChange={(e) => setNewSupplier((p) => ({ ...p, contact_name: e.target.value }))} />
              <TextField label="Email" size="small" fullWidth value={newSupplier.contact_email}
                onChange={(e) => setNewSupplier((p) => ({ ...p, contact_email: e.target.value }))} />
              <TextField label="Phone" size="small" fullWidth value={newSupplier.contact_phone}
                onChange={(e) => setNewSupplier((p) => ({ ...p, contact_phone: e.target.value }))} />
                <TextField label="Min order qty (MOQ)" type="number" size="small" fullWidth value={newSupplier.moq}
                onChange={(e) => setNewSupplier((p) => ({ ...p, moq: e.target.value }))}
                helperText="Units this supplier requires per order. Leave blank for no minimum." />
              <TextField label="Lead time (days)" type="number" size="small" fullWidth value={newSupplier.lead_time_days}
                onChange={(e) => setNewSupplier((p) => ({ ...p, lead_time_days: e.target.value }))}
                helperText="Days from PO sent to goods received. Used to compute the best reorder date." />
            </Box>
          )}

          {/* ETA */}
          <TextField
            label="Expected delivery date"
            type="date"
            size="small"
            fullWidth
            value={expectedDate}
            onChange={(e) => setExpectedDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />

          {/* LINE ITEMS */}
          <Box>
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ mb: 1, display: 'block' }}>
              LINE ITEMS
            </Typography>
            {lineItems.map((item, idx) => (
              <Box key={item.key} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'flex-start' }}>
                <Box sx={{ flex: 3, position: 'relative' }}>
                  {item.lasyncro_variant_id ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1, px: 1.5, height: 40, overflow: 'hidden' }}>
                      {item.image_url ? (
                        <Box component="img" src={item.image_url} alt="" sx={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 0.5, flexShrink: 0 }} />
                      ) : (
                        <Box sx={{ width: 32, height: 32, borderRadius: 0.5, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Package size={14} style={{ opacity: 0.4 }} />
                        </Box>
                      )}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={600} noWrap>{item.product_title ?? item.description}</Typography>
                        {item.sku && <Typography variant="caption" color="text.secondary">{item.sku}</Typography>}
                      </Box>
                      <IconButton size="small" onClick={() => {
                        setLineItems((prev) => prev.map((i) => i.key === item.key ? { ...i, lasyncro_variant_id: null, description: '', product_title: null, image_url: null, sku: null } : i));
                        setVariantSearch((p) => ({ ...p, [item.key]: '' }));
                      }} sx={{ flexShrink: 0 }}>
                        <XCircle size={14} />
                      </IconButton>
                    </Box>
                  ) : (<>
                  <TextField
                    label="Product / SKU"
                    size="small"
                    fullWidth
                    autoComplete="off"
                    value={variantSearch[item.key] ?? item.description}
                    error={(variantSearch[item.key]?.length ?? 0) > 0 && !item.lasyncro_variant_id && variantOptions.length === 0}
                    helperText={
                      (variantSearch[item.key]?.length ?? 0) > 0 && !item.lasyncro_variant_id && variantOptions.length === 0
                        ? (
                          <span>
                            Not linked to Shopify catalog —{' '}
                             <a
                              href="https://admin.shopify.com/store/products/new"
                              target="_blank"
                              rel="noopener noreferrer"
                              >
                              create the product in Shopify first →
                            </a>
                            <br />Then re-sync.
                          </span>
                        )
                        : undefined
                    }
                    onKeyDown={(e) => {
                      if (!variantOptions.length) return;
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setFocusedOptionIndex((i) => Math.min(i + 1, variantOptions.length - 1));
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setFocusedOptionIndex((i) => Math.max(i - 1, 0));
                      } else if (e.key === 'Enter' && focusedOptionIndex >= 0) {
                        e.preventDefault();
                        const v = variantOptions[focusedOptionIndex];
                        setLineItems((prev) => prev.map((i) => i.key === item.key ? {
                          ...i,
                          description: v.sku ?? v.title ?? '',
                          lasyncro_variant_id: v.lasyncro_variant_id,
                          sku: v.sku,
                          product_title: v.product_title,
                          image_url: v.image_url,
                          unit_cost_cents: variantCostText(v.unit_cost),
                        } : i));
                        setVariantSearch((p) => ({ ...p, [item.key]: '' }));
                        setVariantOptions([]);
                        setFocusedOptionIndex(-1);
                      } else if (e.key === 'Escape') {
                        setVariantOptions([]);
                        setFocusedOptionIndex(-1);
                      }
                    }}
                    onBlur={() => {
                      // Delay clear so click on dropdown option registers first
                      setTimeout(() => {
                        setVariantOptions([]);
                        setFocusedOptionIndex(-1);
                      }, 150);
                    }}
                    onFocus={async () => {
                      if (!item.lasyncro_variant_id) {
                        const results = await onSearchVariants(variantSearch[item.key] ?? '');
                        setVariantOptions(results);
                      }
                    }}
                    onChange={async (e) => {
                      setFocusedOptionIndex(-1);
                      const q = e.target.value;
                      setVariantSearch((p) => ({ ...p, [item.key]: q }));
                      updateLineItem(item.key, 'description', q);
                      setLineItems((prev) => prev.map((i) => i.key === item.key ? { ...i, lasyncro_variant_id: null } : i));
                      if (q.length >= 1) {
                        const results = await onSearchVariants(q);
                        setVariantOptions(results);
                      } else {
                        setVariantOptions([]);
                      }
                    }}
                  />
                  {variantOptions.length > 0 && !item.lasyncro_variant_id && (
                    <Box
                      ref={dropdownRef}
                      onMouseDown={(e) => e.preventDefault()}
                      sx={{
                        position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                        bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider',
                        borderRadius: 1, boxShadow: 3, maxHeight: 200, overflowY: 'auto',
                      }}
                    >
                      {variantOptions.map((v, optIdx) => (
                        <Box
                          key={v.lasyncro_variant_id}
                          onMouseDown={(e) => e.preventDefault()}
                          sx={{ px: 1.5, py: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 1, bgcolor: focusedOptionIndex === optIdx ? 'action.selected' : 'transparent', '&:hover': { bgcolor: focusedOptionIndex === optIdx ? 'action.selected' : 'action.hover' } }}
                          onClick={() => {
                            setLineItems((prev) => prev.map((i) => i.key === item.key ? {
                              ...i,
                              description: v.sku ?? v.title ?? '',
                              lasyncro_variant_id: v.lasyncro_variant_id,
                              sku: v.sku,
                              product_title: v.product_title,
                              image_url: v.image_url,
                              unit_cost_cents: variantCostText(v.unit_cost),
                            } : i));
                            setVariantSearch((p) => ({ ...p, [item.key]: '' }));
                            setVariantOptions([]);
                          }}
                        >
                          {v.image_url ? (
                            <Box component="img" src={v.image_url} alt="" sx={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 0.5, flexShrink: 0 }} />
                          ) : (
                            <Box sx={{ width: 32, height: 32, borderRadius: 0.5, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <Package size={14} style={{ opacity: 0.4 }} />
                            </Box>
                          )}
                          <Box>
                            <Typography variant="body2" fontWeight={600} sx={{ lineHeight: 1.3 }}>{v.product_title ?? v.title ?? 'Unknown product'}</Typography>
                            {v.sku && <Typography variant="caption" color="text.secondary">{v.sku}</Typography>}
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  )}
                  </>)}
                </Box>
                <TextField
                  label="Qty *"
                  size="small"
                  type="number"
                  autoComplete="off"
                  value={item.quantity_ordered}
                  onChange={(e) => updateLineItem(item.key, 'quantity_ordered', e.target.value)}
                  inputProps={{ min: 1 }}
                  error={item.quantity_ordered !== '' && (isNaN(parseInt(item.quantity_ordered, 10)) || parseInt(item.quantity_ordered, 10) < 1)}
                  helperText={item.quantity_ordered !== '' && (isNaN(parseInt(item.quantity_ordered, 10)) || parseInt(item.quantity_ordered, 10) < 1) ? 'Enter a whole number ≥ 1' : undefined}
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="Unit cost"
                  size="small"
                  type="text"
                  autoComplete="off"
                  inputMode="decimal"
                  value={item.unit_cost_cents}
                  onChange={(e) => {
                    const raw = e.target.value;
                    // Allow only positive numbers with up to 2 decimal places
                    if (raw === '' || /^\d*\.?\d{0,2}$/.test(raw)) {
                      updateLineItem(item.key, 'unit_cost_cents', raw);
                    }
                  }}
                  onBlur={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      updateLineItem(item.key, 'unit_cost_cents', val.toFixed(2));
                    }
                  }}
                  error={item.unit_cost_cents !== '' && isNaN(parseFloat(item.unit_cost_cents))}
                  helperText={item.unit_cost_cents !== '' && isNaN(parseFloat(item.unit_cost_cents)) ? 'Enter a number (e.g. 12.99)' : undefined}
                  inputProps={{}}
                  InputProps={{
                    startAdornment: (
                      <Box component="span" sx={{ mr: 0.5, color: 'text.secondary', fontSize: 13 }}>$</Box>
                    ),
                  }}
                />
                <IconButton
                  size="small"
                  onClick={() => removeLineItem(item.key)}
                  disabled={lineItems.length === 1}
                  sx={{ mt: 0.5 }}
                >
                  <Trash2 size={14} />
                </IconButton>
              </Box>
            ))}
            <Button size="small" startIcon={<Plus size={14} />} onClick={addLineItem}>
              Add line item
            </Button>
          </Box>

          {/* NOTES */}
          <TextField
            label="Notes"
            size="small"
            fullWidth
            multiline
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any notes about this PO..."
          />
        </Box>
    </EntityDetailModal>
  );
}

// ─────────────────────────────────────────────
// PO ACCORDION
// ─────────────────────────────────────────────

function RatingBadge({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null;
  const color = value >= 90 ? 'success' : value >= 70 ? 'warning' : 'error';
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Chip label={`${Math.round(value)}%`} size="small" color={color} />
    </Box>
  );
}

function ReceiveShipmentDialog({
  open,
  lineItems,
  onClose,
  onConfirm,
}: {
  open: boolean;
  lineItems: PoLineItem[] | null;
  onClose: () => void;
  onConfirm: (items: { line_item_id: string; quantity_received: number }[], notes: string) => Promise<void>;
}) {
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setError(null);
    const items = (lineItems ?? [])
      .map((item) => ({
        line_item_id: item.id,
        quantity_received: parseInt(quantities[item.id] ?? '0', 10),
      }))
      .filter((item) => item.quantity_received > 0);

    if (items.length === 0) return setError('Enter at least one received quantity.');

    setSubmitting(true);
    try {
      await onConfirm(items, notes);
      onClose();
    } catch {
      setError('Failed to record receipt.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Receive Shipment</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {!lineItems && <ModuleLoadingSkeleton rows={1} height={20} />}
          {lineItems && lineItems.map((item) => {
            const remaining = item.quantity_ordered - item.quantity_received;
            return (
              <Box key={item.id} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box sx={{ flex: 3 }}>
                  <Typography variant="body2" fontWeight={600}>{item.description}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Ordered: {item.quantity_ordered} · Already received: {item.quantity_received} · Remaining: {remaining}
                  </Typography>
                </Box>
                <TextField
                  label="Qty received"
                  size="small"
                  type="number"
                  value={quantities[item.id] ?? ''}
                  onChange={(e) => setQuantities((p) => ({ ...p, [item.id]: e.target.value }))}
                  inputProps={{ min: 0, max: remaining }}
                  sx={{ flex: 1 }}
                  disabled={remaining === 0}
                />
              </Box>
            );
          })}
          <TextField
            label="Notes"
            size="small"
            fullWidth
            multiline
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any notes about this shipment..."
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button variant="contained" color="success" onClick={() => void handleConfirm()} disabled={submitting}>
          {submitting ? 'Recording...' : 'Confirm Receipt'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─────────────────────────────────────────────
// PO PROGRESS TRACK
// ─────────────────────────────────────────────
/**
 * GH-1245 — canonical job-first, ownership-aware Receive decision shared by
 * the PO accordion CTA and the action=receive deep-link. The PO projection
 * only carries the active (non-closed/cancelled) job, so any non-pending
 * status means the job has started. Inconsistent or unknown state fails
 * closed ('none') so no duplicate Receive job can be dispatched.
 */
export type ReceiveAction = 'assign' | 'open_own' | 'resume_own' | 'reassign' | 'none';

function resolveReceiveAction(
  po: PurchaseOrder,
  currentUserId: number | null
): ReceiveAction {
  const jobId = po.receive_job_id ?? null;
  const status = po.receive_status ?? null;
  const assigneeId = po.receive_assigned_operator_id ?? null;

  if (jobId == null) {
    return status == null && assigneeId == null ? 'assign' : 'none';
  }
  if (status == null) return 'none';
  // Legacy pending/unassigned work — guarded 409 recovery in the app wrapper.
  if (status === 'pending' && assigneeId == null) return 'assign';
  if (currentUserId != null && assigneeId === currentUserId) {
    return status === 'pending' ? 'open_own' : 'resume_own';
  }
  // GH-1143 — pending work assigned to another operator is managed only via
  // explicit Reassign. Started work owned by another operator: no action.
  return status === 'pending' ? 'reassign' : 'none';
}

/**
 * WS-UX-01 S1 — the single contextual next step for a PO. Pure function of
 * the canonical stored status plus the existing Receive decision; it never
 * maps to new stored statuses. Receive-eligible POs keep the GH-1245
 * resolveReceiveAction() decision unchanged (including its fail-closed
 * 'none'), so S1 introduces no new Receive affordance.
 */
export type PoNextAction =
  | { kind: 'mark_sent' }
  | { kind: 'mark_arrived' }
  | { kind: 'receive'; receiveAction: ReceiveAction }
  | { kind: 'none' };

export function resolvePoNextAction(
  po: PurchaseOrder,
  currentUserId: number | null
): PoNextAction {
  switch (po.status) {
    case 'draft':
      return { kind: 'mark_sent' };
    case 'ordered':
    case 'confirmed':
    case 'in_production':
      return { kind: 'mark_arrived' };
    case 'shipped':
    case 'partially_received':
      return { kind: 'receive', receiveAction: resolveReceiveAction(po, currentUserId) };
    default:
      return { kind: 'none' };
  }
}

/**
 * WS-UX-01 S1 — Cancel is offered only for open POs with no known Receive
 * job. Any job reference (even pending) fails closed, matching the backend
 * rule that rejects every status change while a job is active. The backend
 * remains authoritative: a stale projection only ever hides the action.
 * Once physical counting has started, Cancel stays unavailable even when the
 * job-reference projection is absent or stale.
 */
export function canCancelPo(po: PurchaseOrder): boolean {
  return (
    OPEN_STATUSES.includes(po.status) &&
    po.receive_job_id == null &&
    po.receive_status == null &&
    po.receive_assigned_operator_id == null &&
    !isReceiveCountingStarted(po)
  );
}

/**
 * WS-UX-01 S1 — whether physical Receive counting has started for this PO.
 * Before that, a received quantity of 0 is not a count and renders as "—".
 */
export function isReceiveCountingStarted(po: PurchaseOrder): boolean {
  return (
    po.status === 'partially_received' ||
    po.status === 'received' ||
    (po.receive_status != null && po.receive_status !== 'pending') ||
    Number(po.total_units_received) > 0
  );
}

/**
 * WS-UX-01 S2 — a failure is ambiguous when the server's outcome is unknown:
 * no HTTP response (network/timeout) or a 5xx. Definite 4xx refusals and
 * explicit errors raised by the app wrapper's 409 recovery are not.
 */
function isAmbiguousReceiveFailure(err: unknown): boolean {
  const e = err as { isAxiosError?: boolean; response?: { status?: number } } | null;
  if (e?.isAxiosError) {
    const status = e.response?.status;
    return status == null || status >= 500;
  }
  return !(err instanceof Error);
}

/** WS-UX-01 S2 — HTTP 409 (or the app wrapper's 409 recovery): concurrent Receive activity. */
function isReceiveConflict(err: unknown): boolean {
  const e = err as { status?: number; response?: { status?: number } } | null;
  return e?.status === 409 || e?.response?.status === 409;
}

function receiveFailureMessage(err: unknown, fallback: string): string {
  const serverMessage = (err as { response?: { data?: { error?: unknown } } } | null)
    ?.response?.data?.error;
  if (typeof serverMessage === 'string' && serverMessage.trim()) return serverMessage;
  if ((err as { isAxiosError?: boolean } | null)?.isAxiosError) return fallback;
  return err instanceof Error && err.message ? err.message : fallback;
}

/** WS-UX-01 S3 — the parts of GET /receive-jobs/:jobId the inline brief reads. */
export type ReceiveJobDetail = {
  job: {
    receive_job_id: string;
    po_id: string;
    status: string;
    assigned_operator_id: number | null;
    started_at: string | null;
    supplier_name?: string | null;
  };
  lines: Array<{
    receive_job_line_id: string;
    quantity_expected: number;
    quantity_accepted?: number | null;
  }>;
};

/** Mirrors the WMS session's active (started) Receive statuses. */
const STARTED_RECEIVE_STATUSES = new Set(['in_progress', 'inspection', 'barcode_assignment', 'stow_ready']);

export type ReceiveBriefModel =
  | { ok: true; supplierName: string | null; lineCount: number; expectedUnits: number; remainingUnits: number }
  | { ok: false; reason: 'changed' | 'no_lines' };

function isCount(value: unknown): boolean {
  return Number.isSafeInteger(Number(value)) && Number(value) >= 0 && value !== '' && value !== null;
}

/**
 * WS-UX-01 S3 — the inline brief for the viewer's own pending job, from the
 * canonical job only. Expected quantities are display-only: they never prefill
 * or confirm a physical count. Anything inconsistent with "pending, assigned to
 * the viewer, never started, this PO" or without valid lines disables Start.
 */
export function resolveReceiveBrief(
  detail: ReceiveJobDetail | null | undefined,
  expected: { jobId: string; poId: string; currentUserId: number | null }
): ReceiveBriefModel {
  const job = detail?.job;
  if (
    !job ||
    expected.currentUserId == null ||
    job.receive_job_id !== expected.jobId ||
    job.po_id !== expected.poId ||
    job.status !== 'pending' ||
    job.assigned_operator_id !== expected.currentUserId ||
    job.started_at != null
  ) {
    return { ok: false, reason: 'changed' };
  }
  const lines = Array.isArray(detail?.lines) ? detail.lines : [];
  const valid =
    lines.length > 0 &&
    lines.every((line) =>
      typeof line?.receive_job_line_id === 'string' &&
      line.receive_job_line_id !== '' &&
      isCount(line.quantity_expected) &&
      (line.quantity_accepted == null || isCount(line.quantity_accepted))
    );
  if (!valid) return { ok: false, reason: 'no_lines' };
  const expectedUnits = lines.reduce((sum, line) => sum + Number(line.quantity_expected), 0);
  if (expectedUnits <= 0) return { ok: false, reason: 'no_lines' };
  const remainingUnits = lines.reduce(
    (sum, line) => sum + Math.max(0, Number(line.quantity_expected) - Number(line.quantity_accepted ?? 0)),
    0
  );
  return {
    ok: true,
    supplierName: job.supplier_name?.trim() || null,
    lineCount: lines.length,
    expectedUnits,
    remainingUnits,
  };
}

/** WS-UX-01 S3 — the canonical job shows Receive started by this viewer. */
function isReceiveStartedBy(
  detail: ReceiveJobDetail | null | undefined,
  jobId: string,
  currentUserId: number | null
): boolean {
  const job = detail?.job;
  return (
    job != null &&
    currentUserId != null &&
    job.receive_job_id === jobId &&
    job.assigned_operator_id === currentUserId &&
    job.started_at != null &&
    STARTED_RECEIVE_STATUSES.has(job.status)
  );
}

/**
 * WS-UX-01 S3 — after a definite claim refusal, the canonical job and PO must
 * agree before anything unlocks. A PO still pointing at the job must show the
 * job's status and assignee; a PO no longer pointing at it must mean the job
 * is closed or cancelled. A 409 whose canonical state is still "pending,
 * mine" contradicts the refusal and fails closed.
 */
function isRefusalReconciled(
  detail: ReceiveJobDetail | null | undefined,
  canonicalPo: PurchaseOrder,
  expected: { jobId: string; poId: string; currentUserId: number | null },
  conflict: boolean
): boolean {
  const job = detail?.job;
  if (!job || job.receive_job_id !== expected.jobId || job.po_id !== expected.poId) return false;
  if (canonicalPo.receive_job_id === expected.jobId) {
    if (
      canonicalPo.receive_status !== job.status ||
      (canonicalPo.receive_assigned_operator_id ?? null) !== (job.assigned_operator_id ?? null)
    ) {
      return false;
    }
  } else if (job.status !== 'closed' && job.status !== 'cancelled') {
    return false;
  }
  return !(conflict && resolveReceiveBrief(detail, expected).ok);
}

const CLAIM_REFUSAL_MESSAGES: Record<string, string> = {
  JOB_CLAIMED_BY_OTHER: 'This Receive is now assigned to someone else.',
  JOB_NOT_ASSIGNED: "This Receive isn't assigned to anyone now.",
  JOB_NOT_CLAIMABLE: 'This Receive can no longer be started.',
  JOB_CLAIM_CONFLICT: 'This Receive changed while you were starting it.',
};

function claimRefusalMessage(err: unknown): string {
  const e = err as { response?: { status?: number; data?: { error?: unknown } } } | null;
  const code = e?.response?.data?.error;
  if (typeof code === 'string' && CLAIM_REFUSAL_MESSAGES[code]) return CLAIM_REFUSAL_MESSAGES[code];
  if (e?.response?.status === 404) return 'This Receive no longer exists.';
  return receiveFailureMessage(err, 'Receive could not be started.');
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** WS-UX-01 S2 — the Receive state an assignment mutation should produce. */
type ReceiveExpectation = { jobId: string | null; assigneeId: number };

/** A null jobId (outcome of an ambiguous create) accepts any active job. */
function poMatchesReceiveExpectation(
  po: PurchaseOrder | null | undefined,
  expected: ReceiveExpectation
): boolean {
  return (
    po != null &&
    po.receive_job_id != null &&
    po.receive_assigned_operator_id === expected.assigneeId &&
    (expected.jobId == null || po.receive_job_id === expected.jobId)
  );
}

/** The Receive fields of a PO projection. */
type ReceiveSnapshot = {
  jobId: string | null;
  status: string | null;
  assigneeId: number | null;
};

function receiveSnapshotOf(po: PurchaseOrder): ReceiveSnapshot {
  return {
    jobId: po.receive_job_id ?? null,
    status: po.receive_status ?? null,
    assigneeId: po.receive_assigned_operator_id ?? null,
  };
}

function sameReceiveSnapshot(a: ReceiveSnapshot, b: ReceiveSnapshot): boolean {
  return a.jobId === b.jobId && a.status === b.status && a.assigneeId === b.assigneeId;
}

/**
 * A reconciled canonical state the projection has not rendered yet. The
 * projection counts as reconciled once it shows that state, or anything
 * newer than the stale state the mutation started from.
 */
type AwaitedReceive = { reconciled: ReceiveSnapshot; stale: ReceiveSnapshot };

/** WS-UX-01 S4 D6 — an active Receive job has started (projection only). */
function hasStartedReceive(po: PurchaseOrder): boolean {
  return po.receive_job_id != null && po.receive_status != null && po.receive_status !== 'pending';
}

/**
 * WS-UX-01 S4 — a stored delivery date as a local calendar day. The leading
 * YYYY-MM-DD is the calendar date (never shifted through UTC midnight); a
 * missing or malformed value is null.
 */
function parseCalendarDate(value?: string | null): Date | null {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function formatShortDate(value?: string | null): string | null {
  const date = parseCalendarDate(value);
  return date ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
}

/**
 * WS-UX-01 S4 — only an outstanding On the way PO can be overdue: its expected
 * date is before today's local calendar date. Due today is not overdue.
 */
export function isPoOverdue(po: PurchaseOrder, today: Date = new Date()): boolean {
  if (po.status !== 'ordered' && po.status !== 'confirmed' && po.status !== 'in_production') return false;
  const expected = parseCalendarDate(po.expected_delivery_date);
  if (!expected) return false;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return expected.getTime() < startOfToday.getTime();
}

/**
 * WS-UX-01 S4 — Next step heading for the S1 lifecycle steps and unassigned
 * arrivals. Receive states with their own certified copy (S2/S3) get none.
 */
function resolveNextStepCopy(
  po: PurchaseOrder,
  nextAction: PoNextAction
): { title: string; body?: string } | null {
  if (nextAction.kind === 'mark_sent') {
    return { title: 'Not sent yet', body: 'Send it to your supplier however you usually do, then mark it as sent.' };
  }
  if (nextAction.kind === 'mark_arrived') {
    const due = formatShortDate(po.expected_delivery_date);
    return {
      title: !due ? 'On the way' : isPoOverdue(po) ? `On the way · Overdue · ${due}` : `On the way · due ${due}`,
      body: 'Mark it as arrived once the delivery is in your warehouse.',
    };
  }
  if (nextAction.kind === 'receive' && nextAction.receiveAction === 'resume_own') {
    return { title: 'Receiving · in progress', body: 'Counts save as you go. Resume to continue where you left off.' };
  }
  if (nextAction.kind === 'receive' && nextAction.receiveAction === 'assign') {
    return { title: 'Arrived · not assigned yet', body: "Choose who counts this delivery. Assigning doesn't begin the count." };
  }
  return null;
}

/** WS-UX-01 S4 — the one date that matters for the PO's stage. */
function poDateLabel(po: PurchaseOrder): string | null {
  const expected = formatShortDate(po.expected_delivery_date);
  if (po.status === 'draft') return expected ? `Expected ${expected}` : null;
  if (po.status === 'shipped' || po.status === 'partially_received') {
    const arrived = formatShortDate(po.actual_delivery_date);
    return arrived ? `Arrived ${arrived}` : expected ? `Due ${expected}` : null;
  }
  if (!expected) return null;
  return isPoOverdue(po) ? `Overdue · ${expected}` : `Due ${expected}`;
}

const LINE_TABLE_HEAD_SX = {
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
} as const;

/** WS-UX-01 S4 — short lists stay a plain list; inspection tools from this many lines. */
export const LINE_INSPECT_MIN = 6;

export type LineSortKey = 'default' | 'product' | 'ordered' | 'received';
export type LineFilterKey = 'all' | 'outstanding' | 'received';

const LINE_SORTS: Array<[LineSortKey, string]> = [
  ['default', 'Original order'],
  ['product', 'Product A–Z'],
  ['ordered', 'Ordered quantity'],
  ['received', 'Received quantity'],
];

const LINE_FILTERS: Array<[LineFilterKey, string]> = [
  ['all', 'All lines'],
  ['outstanding', 'Outstanding quantity'],
  ['received', 'Fully received'],
];

const lineProductName = (item: PoLineItem) => item.product_title ?? item.description;

/**
 * WS-UX-01 S4 — in-memory line inspection: search product name or SKU,
 * filter by outstanding (received < ordered) or fully received, and sort
 * stably (quantities highest first; ties keep the API order).
 */
export function inspectLineItems(
  items: PoLineItem[],
  { search, filter, sort }: { search: string; filter: LineFilterKey; sort: LineSortKey },
): PoLineItem[] {
  const q = search.trim().toLowerCase();
  const shown = items.filter((item) => {
    const outstanding = Number(item.quantity_received) < Number(item.quantity_ordered);
    if (filter === 'outstanding' && !outstanding) return false;
    if (filter === 'received' && outstanding) return false;
    return !q || lineProductName(item).toLowerCase().includes(q) || (item.sku ?? '').toLowerCase().includes(q);
  });
  if (sort === 'default') return shown;
  const compare = (a: PoLineItem, b: PoLineItem) =>
    sort === 'product'
      ? lineProductName(a).localeCompare(lineProductName(b), undefined, { sensitivity: 'base' })
      : sort === 'ordered'
      ? Number(b.quantity_ordered) - Number(a.quantity_ordered)
      : Number(b.quantity_received) - Number(a.quantity_received);
  return shown
    .map((item, index) => ({ item, index }))
    .sort((x, y) => compare(x.item, y.item) || x.index - y.index)
    .map(({ item }) => item);
}

const RECEIVE_RELOAD_REQUIRED =
  'Reload the page before making another change to this Receive.';

function PoDetail({
  po,
  selected = false,
  onStartClaimChange,
  onDeepLinkHandled,
  onFetchLineItems,
  onUpdatePoStatus,
  onCreateReceiveJob,
  onReassignReceiveJob,
  teamAssignableOperators,
  receiveAssigneesStatus,
  onRetryReceiveAssignees,
  canManageReceiveAssignment,
  currentUserId,
  onReconcilePurchaseOrders,
  onFetchReceiveJob,
  onClaimReceiveJob,
  autoOpenReceive = false,
  receiveDispatchAssignmentSpotlight,
  narrow = false,
}: {
  po: PurchaseOrder;
  onFetchLineItems: (poId: string) => Promise<PoLineItem[]>;
  onUpdatePoStatus: (poId: string, status: PurchaseOrderStatus, actualDeliveryDate?: string) => Promise<void>;
  onCreateReceiveJob: (
    poId: string,
    input: { assigned_operator_id: number }
  ) => Promise<{ receive_job_id: string }>;
  /** GH-1143 RECEIVE-REASSIGN-UI-01 — reassigns an EXISTING pending/unstarted job. */
  onReassignReceiveJob?: (jobId: string, targetOperatorId: number) => Promise<void>;
  teamAssignableOperators: ReceiveAssignableOperator[];
  receiveAssigneesStatus: ReceiveAssigneesStatus;
  onRetryReceiveAssignees?: () => void;
  canManageReceiveAssignment: boolean;
  currentUserId: number | null;
  onReconcilePurchaseOrders?: () => Promise<PurchaseOrder[]>;
  onFetchReceiveJob?: (jobId: string) => Promise<ReceiveJobDetail>;
  onClaimReceiveJob?: (jobId: string) => Promise<void>;
  autoOpenReceive?: boolean;
  /** WS-UX-01 S4 — this PO is the one shown in the detail pane. */
  selected?: boolean;
  /** WS-UX-01 S4 D1 — an explicit Start receiving claim holds the selection until it resolves. */
  onStartClaimChange?: (poId: string, inFlight: boolean) => void;
  /** WS-UX-01 S4 D3 — the action=receive deep link was evaluated here (without navigating away). */
  onDeepLinkHandled?: (poId: string) => void;
  /** GH-1109 residual: assignment vs claim/start onboarding, rendered inside the assignment popover. */
  receiveDispatchAssignmentSpotlight?: { isDismissed: boolean; dismiss: () => void };
  /** WS-UX-01 S5-B — single-pane workspace (< 880px): stacked actions, compact progress. */
  narrow?: boolean;
}) {
  // WS-UX-01 S4 — the detail is mounted on first selection and kept mounted,
  // so mutation locks, reconciliation and the line-item cache survive
  // switching to another PO. "Expanded" now means "selected".
  const expanded = selected;
  const [lineItems, setLineItems] = useState<PoLineItem[] | null>(null);
  const [lineItemsFailed, setLineItemsFailed] = useState(false);
  // WS-UX-01 S4 — display-only line inspection (>= LINE_INSPECT_MIN lines).
  const [lineSearch, setLineSearch] = useState('');
  const [lineFilter, setLineFilter] = useState<LineFilterKey>('all');
  const [lineSort, setLineSort] = useState<LineSortKey>('default');
  const [lineFilterAnchor, setLineFilterAnchor] = useState<HTMLElement | null>(null);
  const [lineSortAnchor, setLineSortAnchor] = useState<HTMLElement | null>(null);
  // True while a line-item request is in flight or has succeeded (the cache).
  const lineItemsRequestedRef = useRef(false);
  // The automatic load happens once, on first selection; never as a retry loop.
  const lineItemsAutoLoadedRef = useRef(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // GH-1109: dispatch happens before execution. Assignment does not claim work.
  // WS-UX-01 S2 — a compact popover replaces the Assign Receive modal; the
  // same popover serves initial assignment and GH-1143 reassignment.
  const [assignAnchor, setAssignAnchor] = useState<HTMLElement | null>(null);
  const [assignMode, setAssignMode] = useState<'assign' | 'reassign'>('assign');
  const assignButtonRef = useRef<HTMLButtonElement | null>(null);
  // In-flight lock: the ref blocks repeat clicks before React re-renders.
  const receiveInFlightRef = useRef(false);
  // 'locked': the outcome could not be confirmed; a page reload is required
  // before any further assignment mutation on this PO.
  const [receiveMutation, setReceiveMutation] =
    useState<'idle' | 'pending' | 'reconciling' | 'locked'>('idle');
  // A confirmed result the PO projection has not rendered yet. Controls stay
  // disabled until it does, so nothing unlocks against a stale projection.
  const [awaitedReceive, setAwaitedReceive] = useState<AwaitedReceive | null>(null);
  const [receiveSlow, setReceiveSlow] = useState(false);
  const [receiveDispatchError, setReceiveDispatchError] =
    useState<string | null>(null);
  const [receiveAssignmentConfirmation, setReceiveAssignmentConfirmation] =
    useState<string | null>(null);
  // WS-UX-01 S1 — Cancel PO requires a named confirmation (S4: a visible secondary action).
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancellingPo, setCancellingPo] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const navigate = useNavigate();

  /** Authoritative re-read of this PO; throws when it cannot be confirmed. */
  const readCanonicalPo = useCallback(async (): Promise<PurchaseOrder | null> => {
    if (!onReconcilePurchaseOrders) {
      throw new Error('Purchase order reconciliation is unavailable.');
    }
    const purchaseOrders = await onReconcilePurchaseOrders();
    return purchaseOrders.find((candidate) => candidate.id === po.id) ?? null;
  }, [onReconcilePurchaseOrders, po.id]);

  /**
   * WS-UX-01 S2 — one wrapper for every assignment mutation.
   * - The first click locks; repeat clicks are ignored; after 2 seconds the
   *   panel says it is still working.
   * - Success is reconciled against an awaited canonical PO re-read before the
   *   controls unlock, and they stay disabled until the projection renders it.
   * - An ambiguous failure (no response, or 5xx) is never treated as a
   *   failure: the canonical PO is re-read and a confirmed change is shown as
   *   persisted. Anything inconclusive, or a failed re-read, locks the
   *   controls until the page is reloaded.
   * - A definite refusal (4xx, or the app wrapper's 409-recovery errors)
   *   changed nothing and unlocks with its reason.
   */
  const runReceiveMutation = useCallback(async (options: {
    stale: ReceiveSnapshot;
    mutate: () => Promise<ReceiveExpectation>;
    intended: ReceiveExpectation;
    confirmedMessage: string;
    failureMessage: string;
  }) => {
    if (receiveInFlightRef.current) return;
    receiveInFlightRef.current = true;
    setReceiveMutation('pending');
    setReceiveDispatchError(null);
    setReceiveAssignmentConfirmation(null);
    const slowTimer = setTimeout(() => setReceiveSlow(true), 2000);
    const lockUntilReload = (message: string) => {
      setReceiveDispatchError(`${message} ${RECEIVE_RELOAD_REQUIRED}`);
      setReceiveMutation('locked');
    };
    try {
      let expected: ReceiveExpectation;
      let ambiguous = false;
      try {
        expected = await options.mutate();
      } catch (err) {
        if (isReceiveConflict(err)) {
          // Concurrent Receive activity: keep the refusal reason, never treat
          // it as success, and render the reconciled job state before unlocking.
          const reason = receiveFailureMessage(err, options.failureMessage);
          setReceiveDispatchError(reason);
          setReceiveMutation('reconciling');
          let conflictPo: PurchaseOrder | null;
          try {
            conflictPo = await readCanonicalPo();
          } catch {
            lockUntilReload(`${reason} This PO couldn't be reloaded to show its current state.`);
            return;
          }
          if (!conflictPo || sameReceiveSnapshot(receiveSnapshotOf(conflictPo), options.stale)) {
            lockUntilReload(`${reason} The latest PO doesn't show the change yet.`);
            return;
          }
          setAwaitedReceive({ reconciled: receiveSnapshotOf(conflictPo), stale: options.stale });
          receiveInFlightRef.current = false;
          setReceiveMutation('idle');
          return;
        }
        if (!isAmbiguousReceiveFailure(err)) {
          setReceiveDispatchError(receiveFailureMessage(err, options.failureMessage));
          receiveInFlightRef.current = false;
          setReceiveMutation('idle');
          return;
        }
        ambiguous = true;
        expected = options.intended;
      }

      setReceiveMutation('reconciling');
      let canonical: PurchaseOrder | null;
      try {
        canonical = await readCanonicalPo();
      } catch {
        lockUntilReload(
          ambiguous
            ? "We couldn't confirm whether that change was saved, and couldn't reload this PO."
            : "The change was saved, but this PO couldn't be reloaded to confirm it."
        );
        return;
      }

      if (canonical && poMatchesReceiveExpectation(canonical, expected)) {
        setAwaitedReceive({ reconciled: receiveSnapshotOf(canonical), stale: options.stale });
        setReceiveAssignmentConfirmation(options.confirmedMessage);
        receiveInFlightRef.current = false;
        setReceiveMutation('idle');
        return;
      }
      lockUntilReload(
        ambiguous
          ? "We couldn't confirm that change. The latest PO doesn't show it yet, but it may still be processing."
          : "The change was saved, but the latest PO doesn't show it yet."
      );
    } finally {
      clearTimeout(slowTimer);
      setReceiveSlow(false);
    }
  }, [readCanonicalPo]);

  const handleOpenAssignPopover = useCallback((mode: 'assign' | 'reassign') => {
    if (receiveInFlightRef.current) return;
    setAssignMode(mode);
    setReceiveDispatchError(null);
    setReceiveAssignmentConfirmation(null);
    setAssignAnchor(assignButtonRef.current);
  }, []);

  const operatorName = (operatorId: number) =>
    teamAssignableOperators.find((o) => o.id === operatorId)?.name ?? 'operator';

  /** Picking an operator is the explicit dispatch decision — no confirm step. */
  const handleDispatchReceive = (operatorId: number) => {
    const isSelf = operatorId === currentUserId;
    return runReceiveMutation({
      stale: receiveSnapshotOf(po),
      intended: { jobId: null, assigneeId: operatorId },
      confirmedMessage: isSelf
        ? "Receive is assigned to you. Start receiving when you're ready."
        : `Receive assigned to ${operatorName(operatorId)}. ` +
          'They can find it in Warehouse → Operations → Receiving ' +
          'and claim & start it there.',
      failureMessage: 'Failed to assign Receive work. Please try again.',
      mutate: async () => {
        setAssignAnchor(null);
        const { receive_job_id } = await onCreateReceiveJob(po.id, {
          assigned_operator_id: operatorId,
        });
        // WS-UX-01 S3 — assignment only, for self too: the reconciled PO
        // renders the inline brief, and Start receiving is a separate click.
        return { jobId: receive_job_id, assigneeId: operatorId };
      },
    });
  };

  /** GH-1143 — reassigns the EXISTING job; never routes through creation. */
  const handleReassignReceive = (operatorId: number) => {
    const jobId = po.receive_job_id ?? null;
    return runReceiveMutation({
      stale: receiveSnapshotOf(po),
      intended: { jobId, assigneeId: operatorId },
      confirmedMessage: `Receive reassigned to ${operatorName(operatorId)}.`,
      failureMessage: 'Failed to reassign Receive work. Please try again.',
      mutate: async () => {
        setAssignAnchor(null);
        if (!jobId || !onReassignReceiveJob) {
          throw new Error('Receive job reference is missing.');
        }
        await onReassignReceiveJob(jobId, operatorId);
        return { jobId, assigneeId: operatorId };
      },
    });
  };

  const receiveAction = resolveReceiveAction(po, currentUserId);
  const nextAction = resolvePoNextAction(po, currentUserId);
  const cancelAllowed = canCancelPo(po);
  const countingStarted = isReceiveCountingStarted(po);
  const existingReceiveJobId = po.receive_job_id ?? null;

  // GH-1245 — the current user's own job opens (pending) or resumes
  // (started) that exact job. Never creates or reassigns work.
  const handleOpenOwnReceive = useCallback(() => {
    if (!existingReceiveJobId) return;
    navigate(`/wms?receiveJobId=${existingReceiveJobId}`);
  }, [existingReceiveJobId, navigate]);

  // WS-UX-01 S3 — the viewer's own pending job shows an inline brief read
  // from the canonical job. Fetched only while the PO is expanded; a newer
  // request (or a reconciliation) always supersedes an older response.
  const [receiveBrief, setReceiveBrief] = useState<{
    jobId: string;
    status: 'loading' | 'ready' | 'error';
    detail: ReceiveJobDetail | null;
  } | null>(null);
  const receiveBriefRequestRef = useRef(0);
  const briefJobId =
    expanded && receiveAction === 'open_own' ? existingReceiveJobId : null;

  const loadReceiveBrief = useCallback((jobId: string) => {
    const requestId = ++receiveBriefRequestRef.current;
    if (!onFetchReceiveJob) {
      setReceiveBrief({ jobId, status: 'error', detail: null });
      return;
    }
    setReceiveBrief({ jobId, status: 'loading', detail: null });
    onFetchReceiveJob(jobId).then(
      (detail) => {
        if (requestId === receiveBriefRequestRef.current) {
          setReceiveBrief({ jobId, status: 'ready', detail });
        }
      },
      () => {
        if (requestId === receiveBriefRequestRef.current) {
          setReceiveBrief({ jobId, status: 'error', detail: null });
        }
      }
    );
  }, [onFetchReceiveJob]);

  useEffect(() => {
    if (briefJobId) loadReceiveBrief(briefJobId);
  }, [briefJobId, loadReceiveBrief, po.receive_status, po.receive_assigned_operator_id]);

  const receiveBriefModel =
    receiveBrief?.status === 'ready' && receiveBrief.jobId === existingReceiveJobId
      ? resolveReceiveBrief(receiveBrief.detail, {
          jobId: receiveBrief.jobId,
          poId: po.id,
          currentUserId,
        })
      : null;

  /**
   * WS-UX-01 S3 — Start receiving. Claim is the single start transition:
   * exactly one claim per click, for the job the brief was rendered from,
   * never retried automatically.
   * - 200: open that exact job in WMS.
   * - No response / 5xx: one canonical job read decides. Started by the viewer
   *   → open it; still pending and theirs → unlock for an explicit retry;
   *   anything else, or a failed read → lock until reload.
   * - Definite refusal (409/404/other 4xx): keep the reason and re-read the
   *   job and PO. Unlock only when they agree (isRefusalReconciled), and stay
   *   disabled until the projection renders it; a failed or inconsistent
   *   re-read locks until reload.
   */
  const handleStartReceive = useCallback(async () => {
    const jobId = receiveBrief?.jobId ?? null;
    if (
      receiveInFlightRef.current ||
      !jobId ||
      !receiveBriefModel?.ok ||
      jobId !== existingReceiveJobId ||
      !onClaimReceiveJob ||
      !onFetchReceiveJob
    ) {
      return;
    }
    receiveInFlightRef.current = true;
    receiveBriefRequestRef.current += 1;
    onStartClaimChange?.(po.id, true);
    setReceiveMutation('pending');
    setReceiveDispatchError(null);
    setReceiveAssignmentConfirmation(null);
    const slowTimer = setTimeout(() => setReceiveSlow(true), 2000);
    // Both resolved states release the selection hold; a confirmed start
    // navigates away instead.
    const lockUntilReload = (message: string) => {
      setReceiveDispatchError(`${message} ${RECEIVE_RELOAD_REQUIRED}`);
      setReceiveMutation('locked');
      onStartClaimChange?.(po.id, false);
    };
    const unlock = () => {
      receiveInFlightRef.current = false;
      setReceiveMutation('idle');
      onStartClaimChange?.(po.id, false);
    };
    try {
      try {
        await onClaimReceiveJob(jobId);
      } catch (err) {
        if (isAmbiguousReceiveFailure(err)) {
          setReceiveMutation('reconciling');
          let detail: ReceiveJobDetail;
          try {
            detail = await onFetchReceiveJob(jobId);
          } catch {
            lockUntilReload("We couldn't confirm whether Receive started, and couldn't reload it.");
            return;
          }
          if (isReceiveStartedBy(detail, jobId, currentUserId)) {
            navigate(`/wms?receiveJobId=${jobId}`);
            return;
          }
          if (resolveReceiveBrief(detail, { jobId, poId: po.id, currentUserId }).ok) {
            setReceiveBrief({ jobId, status: 'ready', detail });
            // The read shows pending now; that is not proof the claim failed.
            setReceiveDispatchError(
              "We couldn't confirm that Receive started. It still shows as not started, so you can try again."
            );
            unlock();
            return;
          }
          lockUntilReload("We couldn't confirm whether Receive started. The latest Receive doesn't show it.");
          return;
        }
        const reason = claimRefusalMessage(err);
        setReceiveDispatchError(reason);
        setReceiveMutation('reconciling');
        let detail: ReceiveJobDetail;
        let canonicalPo: PurchaseOrder | null;
        try {
          [detail, canonicalPo] = await Promise.all([onFetchReceiveJob(jobId), readCanonicalPo()]);
        } catch {
          lockUntilReload(`${reason} This Receive couldn't be reloaded to show its current state.`);
          return;
        }
        if (!canonicalPo || !isRefusalReconciled(detail, canonicalPo, { jobId, poId: po.id, currentUserId }, isReceiveConflict(err))) {
          lockUntilReload(`${reason} The latest Receive and PO don't show a consistent state yet.`);
          return;
        }
        setReceiveBrief({ jobId, status: 'ready', detail });
        // Controls stay disabled until the PO projection renders the reconciled state.
        setAwaitedReceive({ reconciled: receiveSnapshotOf(canonicalPo), stale: receiveSnapshotOf(po) });
        unlock();
        return;
      }
      navigate(`/wms?receiveJobId=${jobId}`);
    } finally {
      clearTimeout(slowTimer);
      setReceiveSlow(false);
    }
  }, [currentUserId, existingReceiveJobId, navigate, onClaimReceiveJob, onFetchReceiveJob, onStartClaimChange, po.id, readCanonicalPo, receiveBrief?.jobId, receiveBriefModel?.ok]);

  const autoReceiveOpenedRef = useRef(false);
  // WS-UX-01 S2 — a deep link to unassigned work expands the PO and, for a
  // team, opens the assignment popover. It never dispatches on its own.
  const [autoAssignPending, setAutoAssignPending] = useState(false);

  useEffect(() => {
    if (
      !autoOpenReceive ||
      autoReceiveOpenedRef.current ||
      (po.status !== 'shipped' && po.status !== 'partially_received')
    ) {
      return;
    }
    // GH-1245 — ownership cannot be decided until the authenticated user ID
    // resolves; keep the one-shot guard unconsumed and reevaluate then.
    if (currentUserId == null) return;

    autoReceiveOpenedRef.current = true;
    // GH-1245 — same decision as the PO accordion CTA. Reassignment stays
    // explicit; started work never routes through assignment.
    // WS-UX-01 S3 D5 — the viewer's own pending job needs nothing more: the
    // selected detail shows the inline brief. Nothing here claims.
    if (receiveAction === 'resume_own') {
      handleOpenOwnReceive();
      return;
    }
    if (receiveAction === 'assign') setAutoAssignPending(true);
    onDeepLinkHandled?.(po.id);
  }, [autoOpenReceive, currentUserId, handleOpenOwnReceive, onDeepLinkHandled, po.id, po.status, receiveAction]);

  const status = STATUS_CONFIG[po.status];
  const isOpenPo = OPEN_STATUSES.includes(po.status);
  // WS-UX-01 S4 D6 — "Receiving" only for an active started Receive job.
  const detailStatusLabel = hasStartedReceive(po)
    ? 'Receiving'
    : po.status === 'partially_received'
      ? 'Partially received'
      : status.label;
  const dateLabel = poDateLabel(po);
  const nextStepCopy = resolveNextStepCopy(po, nextAction);

  const isReceiveEligible =
    po.status === 'shipped' || po.status === 'partially_received';

  // GH-1143 RECEIVE-REASSIGN-UI-01 — an existing PENDING/UNSTARTED Receive
  // job already assigned to another operator gets explicit "Reassign Receive"
  // instead of the initial "Receive via WMS" → Assign flow. Once the job
  // has started (or closed/cancelled), receive_status !== 'pending' and no
  // Reassign affordance is offered — no takeover path (see J).
  // GH-1245 — all Receive CTAs derive from resolveReceiveAction.
  const canReassignExistingReceive = receiveAction === 'reassign';
  const canOpenOwnReceive =
    receiveAction === 'open_own' || receiveAction === 'resume_own';
  const receiveJobStarted = receiveAction === 'resume_own';
  const canStartReceiveDispatch = receiveAction === 'assign';

  // WS-UX-01 S2 — "Receive myself" only when the LOADED roster proves the
  // viewer is the sole eligible assignee. Loading/error/unavailable never do.
  const receiveRosterReady = receiveAssigneesStatus === 'ready';
  const soleSelfEligible =
    receiveRosterReady &&
    currentUserId != null &&
    teamAssignableOperators.length === 1 &&
    teamAssignableOperators[0].id === currentUserId;
  const awaitingReceiveProjection =
    awaitedReceive != null &&
    !sameReceiveSnapshot(receiveSnapshotOf(po), awaitedReceive.reconciled) &&
    sameReceiveSnapshot(receiveSnapshotOf(po), awaitedReceive.stale);
  const receiveBusy = receiveMutation !== 'idle' || awaitingReceiveProjection;
  const assignPopoverOperators = [
    ...teamAssignableOperators.filter((o) => o.id === currentUserId),
    ...teamAssignableOperators.filter((o) => o.id !== currentUserId),
  ].filter((o) => assignMode === 'assign' || o.id !== po.receive_assigned_operator_id);
  const receiveAssigneeName =
    po.receive_assigned_operator_name?.trim() ||
    (po.receive_assigned_operator_id != null ? `Operator #${po.receive_assigned_operator_id}` : null);

  const receiveAssignmentLabel = isReceiveEligible
    ? po.receive_job_id && po.receive_assigned_operator_id != null
      ? `Receive: Assigned to ${
          po.receive_assigned_operator_name?.trim() ||
          `Operator #${po.receive_assigned_operator_id}`
        }`
      : 'Receive: Not assigned'
    : null;
  const poDisplay = formatPoDisplay(po);
  const inspectLines = (lineItems?.length ?? 0) >= LINE_INSPECT_MIN;
  const lineInspectActive = lineSearch.trim() !== '' || lineFilter !== 'all';
  const shownLineItems = lineItems && inspectLines
    ? inspectLineItems(lineItems, { search: lineSearch, filter: lineFilter, sort: lineSort })
    : lineItems;
  const clearLineInspect = () => { setLineSearch(''); setLineFilter('all'); };

  // WS-UX-01 S4 — line items load on first selection and stay cached. A
  // failed load releases the guard so the explicit Try again can request once
  // more; nothing retries on its own.
  const loadLineItems = useCallback(() => {
    if (lineItemsRequestedRef.current) return;
    lineItemsRequestedRef.current = true;
    setLineItemsFailed(false);
    setLoadingItems(true);
    onFetchLineItems(po.id)
      .then((items) => setLineItems(items))
      .catch(() => {
        lineItemsRequestedRef.current = false;
        setLineItemsFailed(true);
      })
      .finally(() => setLoadingItems(false));
  }, [onFetchLineItems, po.id]);

  useEffect(() => {
    if (!selected || lineItemsAutoLoadedRef.current) return;
    lineItemsAutoLoadedRef.current = true;
    loadLineItems();
  }, [selected, loadLineItems]);

  useEffect(() => {
    if (awaitedReceive != null && !awaitingReceiveProjection) {
      setAwaitedReceive(null);
    }
  }, [awaitedReceive, awaitingReceiveProjection]);

  useEffect(() => {
    if (!autoAssignPending) return;
    if (!expanded) return;
    if (receiveAssigneesStatus === 'loading') return;
    setAutoAssignPending(false);
    if (receiveRosterReady && !soleSelfEligible && assignButtonRef.current) {
      handleOpenAssignPopover('assign');
    }
  }, [autoAssignPending, expanded, receiveAssigneesStatus, receiveRosterReady, soleSelfEligible, handleOpenAssignPopover]);

  // WS-UX-01 S4 — a deselected (hidden) detail keeps its state but never an
  // open popover or menu. An in-flight cancel keeps its dialog.
  useEffect(() => {
    if (selected) return;
    setAssignAnchor(null);
    if (!cancellingPo) {
      setCancelConfirmOpen(false);
      setCancelError(null);
    }
  }, [selected, cancellingPo]);

  const handleStatusUpdate = async (newStatus: PurchaseOrderStatus) => {
    setUpdatingStatus(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      await onUpdatePoStatus(
        po.id,
        newStatus,
        newStatus === 'received' || newStatus === 'partially_received' ? today : undefined
      );
    } catch {
      setError('Failed to update status.');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleOpenCancelConfirm = () => {
    if (!cancelAllowed || receiveBusy || updatingStatus) return;
    setCancelError(null);
    setCancelConfirmOpen(true);
  };

  const handleCloseCancelConfirm = () => {
    if (cancellingPo) return;
    setCancelConfirmOpen(false);
    setCancelError(null);
  };

  // WS-UX-01 S1 — one explicit cancel request. A backend rejection (e.g. the
  // Receive-lifecycle 409) is surfaced as-is: no retry, no alternate path.
  const handleConfirmCancelPo = async () => {
    if (!cancelAllowed || cancellingPo) return;
    setCancellingPo(true);
    setCancelError(null);
    try {
      await onUpdatePoStatus(po.id, 'cancelled');
      setCancelConfirmOpen(false);
    } catch {
      setCancelError(
        "This PO couldn't be cancelled. It may have Receive work in progress — refresh to see its current state."
      );
    } finally {
      setCancellingPo(false);
    }
  };

  /** WS-UX-01 S1 — canCancelPo and the named confirmation still guard it. */
  const cancelPoButton = (
    <Button
      variant="outlined"
      disabled={!cancelAllowed || updatingStatus || receiveBusy || cancellingPo}
      onClick={handleOpenCancelConfirm}
      aria-describedby={!cancelAllowed ? `cancel-po-unavailable-${po.id}` : undefined}
      sx={{ textTransform: 'none', color: 'var(--critical-text)', borderColor: 'var(--rule)', '&:hover': { borderColor: 'var(--critical-border)', bgcolor: 'transparent' } }}
    >
      Cancel PO…
    </Button>
  );

  return (
    <Box
      data-testid={`po-detail-${po.id}`}
      role="region"
      aria-label={`${po.supplier_name} · ${poDisplay}`}
      hidden={!selected}
      sx={{
        display: selected ? 'flex' : 'none',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        border: '1px solid var(--rule)',
        borderRadius: '14px',
        bgcolor: 'var(--surface)',
        overflow: 'hidden',
      }}
    >
      {/* WS-UX-01 S4 — supplier and status, then reference, date and size. */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, px: narrow ? '16px' : '28px', pt: '20px', pb: '14px' }}>
        <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          {/* WS-UX-01 S5-B — narrow: the supplier name wraps instead of truncating. */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0, flexWrap: narrow ? 'wrap' : undefined }}>
            <Typography component="h2" noWrap={!narrow} sx={{ fontSize: 22, fontWeight: 500, lineHeight: 1.2, color: 'var(--ink)', overflowWrap: 'anywhere' }}>
              {po.supplier_name}
            </Typography>
            {hasStartedReceive(po) ? (
              // WS-UX-01 S4 — an active started Receive job always reads the same,
              // whether the PO is still Arrived or already partially received.
              <Chip
                label={detailStatusLabel}
                size="small"
                variant="outlined"
                sx={{ flexShrink: 0, bgcolor: 'var(--accent-ghost)', color: 'var(--accent-text)', borderColor: 'var(--accent-border)', fontWeight: 500 }}
              />
            ) : (
              <Chip label={detailStatusLabel} size="small" color={status.color} sx={{ flexShrink: 0 }} />
            )}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', color: 'var(--ink-3)', fontSize: 13 }}>
            <Box component="span" sx={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}>{poDisplay}</Box>
            {dateLabel && <Box component="span">{dateLabel}</Box>}
            <Box component="span">
              {plural(Number(po.total_units_ordered) || 0, 'unit')} · {plural(Number(po.line_items_count) || 0, 'line')}
            </Box>
            {receiveAssignmentLabel && <Box component="span">{receiveAssignmentLabel}</Box>}
          </Box>
        </Box>
      </Box>

      <PoLifecycleSteps po={po} compact={narrow} />

      <Box sx={{ ...THIN_SCROLL_SX, flex: 1, minHeight: 0, overflow: 'auto', px: narrow ? '16px' : '28px', pb: 2 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {lineItemsFailed && (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
            action={
              <Button
                color="inherit"
                size="small"
                disabled={loadingItems}
                onClick={loadLineItems}
                sx={{ textTransform: 'none' }}
              >
                Try again
              </Button>
            }
          >
            Failed to load line items.
          </Alert>
        )}
        {receiveAssignmentConfirmation && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {receiveAssignmentConfirmation}
          </Alert>
        )}

        {loadingItems && <ModuleLoadingSkeleton rows={1} height={20} />}

        {/* WS-UX-01 S4 — inspection tools only for long lists; display only. */}
        {lineItems && inspectLines && (
          <Box
            role="search"
            aria-label="Filter product lines"
            sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', pt: '4px', pb: '8px' }}
          >
            <TextField
              size="small"
              placeholder="Search product or SKU…"
              inputProps={{ 'aria-label': 'Search product or SKU' }}
              value={lineSearch}
              onChange={(e) => setLineSearch(e.target.value)}
              sx={{ flex: '1 1 200px', minWidth: 0, '& .MuiInputBase-root': { height: 32, fontSize: 13 } }}
            />
            <Button
              variant="outlined"
              aria-haspopup="menu"
              aria-label={`Show: ${LINE_FILTERS.find(([key]) => key === lineFilter)?.[1]}`}
              aria-expanded={lineFilterAnchor ? 'true' : undefined}
              onClick={(e) => setLineFilterAnchor(e.currentTarget)}
              sx={{ ...LIST_TOOL_SX, ...(lineFilter !== 'all' && { color: 'var(--accent-text)', borderColor: 'var(--accent-border)', bgcolor: 'var(--accent-ghost)' }) }}
            >
              {LINE_FILTERS.find(([key]) => key === lineFilter)?.[1]}
            </Button>
            <Button
              variant="outlined"
              aria-haspopup="menu"
              aria-label={`Sort lines: ${LINE_SORTS.find(([key]) => key === lineSort)?.[1]}`}
              aria-expanded={lineSortAnchor ? 'true' : undefined}
              onClick={(e) => setLineSortAnchor(e.currentTarget)}
              sx={{ ...LIST_TOOL_SX, ...(lineSort !== 'default' && { color: 'var(--accent-text)', borderColor: 'var(--accent-border)' }) }}
            >
              Sort
            </Button>
            <Box component="span" role="status" sx={{ fontSize: 12, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
              {lineInspectActive ? `${shownLineItems?.length ?? 0} of ${lineItems.length} lines` : plural(lineItems.length, 'line')}
            </Box>
            <Menu anchorEl={lineFilterAnchor} open={lineFilterAnchor != null} onClose={() => setLineFilterAnchor(null)} MenuListProps={{ dense: true, 'aria-label': 'Show lines' }}>
              {LINE_FILTERS.map(([value, label]) => (
                <MenuItem key={value} role="menuitemradio" aria-checked={lineFilter === value} selected={lineFilter === value} onClick={() => { setLineFilter(value); setLineFilterAnchor(null); }} sx={{ fontSize: 13 }}>
                  {label}
                </MenuItem>
              ))}
            </Menu>
            <Menu anchorEl={lineSortAnchor} open={lineSortAnchor != null} onClose={() => setLineSortAnchor(null)} MenuListProps={{ dense: true, 'aria-label': 'Sort lines' }}>
              {LINE_SORTS.map(([value, label]) => (
                <MenuItem key={value} role="menuitemradio" aria-checked={lineSort === value} selected={lineSort === value} onClick={() => { setLineSort(value); setLineSortAnchor(null); }} sx={{ fontSize: 13 }}>
                  {label}
                </MenuItem>
              ))}
            </Menu>
          </Box>
        )}

        {shownLineItems && shownLineItems.length === 0 && inspectLines && (
          <Box sx={{ py: 3, display: 'grid', gap: 1, justifyItems: 'start' }}>
            <Typography variant="body2" color="text.secondary">
              No product lines match {lineSearch.trim() ? `“${lineSearch.trim()}”` : 'this filter'}.
            </Typography>
            <Button size="small" variant="outlined" onClick={clearLineInspect} sx={{ textTransform: 'none' }}>
              Show all lines
            </Button>
          </Box>
        )}

        {shownLineItems && (shownLineItems.length > 0 || !inspectLines) && (
          <TableContainer
            sx={{
              '& th, & td': { borderBottom: '0.5px solid var(--rule)' },
              '& tbody tr:last-of-type td': { borderBottom: 'none' },
              '& th:first-of-type, & td:first-of-type': { pl: 0 },
              '& th:last-of-type, & td:last-of-type': { pr: 0 },
            }}
          >
            {/* WS-UX-01 S5-B — narrow: columns keep a readable width; the container scrolls sideways. */}
            <Table size="small" sx={narrow ? { minWidth: 360 } : undefined}>
              <TableHead>
                <TableRow>
                  <TableCell sx={LINE_TABLE_HEAD_SX}>Product</TableCell>
                  <TableCell sx={{ ...LINE_TABLE_HEAD_SX, width: 96 }} align="right">Ordered</TableCell>
                  <TableCell sx={{ ...LINE_TABLE_HEAD_SX, width: 96 }} align="right">Received</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {shownLineItems.map((item) => (
                  // WS-UX-01 S4 — informational rows: compact, no hover affordance.
                  <TableRow key={item.id}>
                    <TableCell sx={{ fontSize: 12, py: '8px' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                        {item.image_url ? (
                          <Box component="img" src={item.image_url} alt="" sx={{ width: 32, height: 32, objectFit: 'cover', borderRadius: '6px', flexShrink: 0 }} />
                        ) : (
                          <Box sx={{ width: 32, height: 32, borderRadius: '6px', bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Package size={15} style={{ opacity: 0.4 }} />
                          </Box>
                        )}
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" fontWeight={500} sx={{ fontSize: 13.5, lineHeight: 1.3 }}>{item.product_title ?? item.description}</Typography>
                          {item.sku && <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', lineHeight: 1.3, display: 'block' }}>{item.sku}</Typography>}
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell align="right" sx={{ fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{item.quantity_ordered}</TableCell>
                    <TableCell align="right" sx={{ fontSize: 14, fontVariantNumeric: 'tabular-nums', fontWeight: item.quantity_received > 0 ? 700 : 400 }}>
                      {/* WS-UX-01 S1 — no physical count exists before Receive starts. */}
                      {countingStarted || Number(item.quantity_received) > 0
                        ? item.quantity_received
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {po.notes && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
            Notes: {po.notes}
          </Typography>
        )}
      </Box>

      {/* WS-UX-01 S4 — the Next step section holds the PO's only lifecycle controls. */}
      {isOpenPo && (
        <Box
          data-testid="po-next-step"
          sx={{
            // WS-UX-01 S4 — a compact strip: hairline top rule and an accent
            // edge instead of a tinted card. It grows for briefs and errors.
            borderTop: '1px solid var(--rule)',
            boxShadow: 'inset 2px 0 0 var(--accent)',
            px: '28px',
            py: '12px',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            columnGap: 3,
            rowGap: 1,
            // Same certified controls, at the target's primary-action size and
            // one accent/ink contrast pair (about 7:1 in both themes).
            '& .MuiButton-contained': { minHeight: 44, minWidth: 184, px: 2.5, fontSize: 14, borderRadius: '8px' },
            '& .MuiButton-contained:not(.Mui-disabled)': {
              bgcolor: 'var(--accent)',
              color: 'var(--accent-ink)',
              '&:hover': { bgcolor: 'var(--accent-hover)', opacity: 1 },
            },
            // WS-UX-01 S5-B — narrow: copy above full-width stacked actions.
            ...(narrow ? { px: '16px', flexDirection: 'column', alignItems: 'stretch', '& .MuiButton-contained': { minHeight: 44, minWidth: 0, px: 2.5, fontSize: 14, borderRadius: '8px' } } : null),
          }}
        >
          {/* WS-UX-01 S4 — text column: heading, copy and every supporting
              message. It grows for briefs and errors; the actions never move. */}
          <Box sx={{ display: 'grid', gap: 0.5, flex: narrow ? '0 0 auto' : '1 1 320px', minWidth: 0, alignContent: 'center' }}>
            <Typography sx={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--accent-text)' }}>
              Next step
            </Typography>
            {nextStepCopy && (
              <>
                <Typography sx={{ fontSize: 15, fontWeight: 500, lineHeight: 1.3, color: 'var(--ink)' }}>
                  {nextStepCopy.title}
                </Typography>
                {nextStepCopy.body && (
                  <Typography variant="body2" sx={{ color: 'var(--ink-3)', fontSize: 13 }}>
                    {nextStepCopy.body}
                  </Typography>
                )}
              </>
            )}
            {/* GH-1143 / WS-UX-01 S2 — pending work owned by someone else: show the owner. */}
            {canReassignExistingReceive && (
              <>
                <Typography variant="body2" sx={{ color: 'var(--ink-2)' }}>
                  Assigned to {receiveAssigneeName} · Not started
                </Typography>
                {!canManageReceiveAssignment && (
                  <Typography variant="caption" color="text.secondary">
                    Only owners and admins can reassign receives.
                  </Typography>
                )}
              </>
            )}
            {/* WS-UX-01 S3 — own pending job → inline brief; Start receiving sits in the action group. */}
            {canOpenOwnReceive && !receiveJobStarted && isReceiveEligible && (
              <Box data-testid="receive-inline-brief" sx={{ display: 'grid', gap: 0.5, justifyItems: 'start' }}>
                <Typography variant="body2" sx={{ color: 'var(--ink-2)' }}>
                  {receiveBriefModel?.ok && receiveBriefModel.supplierName
                    ? `Receive from ${receiveBriefModel.supplierName} · ${poDisplay} · `
                    : ''}
                  Assigned to you · Not started
                </Typography>
                {(receiveBrief == null || receiveBrief.status === 'loading') && (
                  <Typography variant="caption" color="text.secondary">
                    Loading receive details…
                  </Typography>
                )}
                {receiveBrief?.status === 'error' && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="caption" color="error">
                      Couldn't load this receive.
                    </Typography>
                    <Button
                      size="small"
                      variant="text"
                      disabled={receiveBusy}
                      onClick={() => { if (existingReceiveJobId) loadReceiveBrief(existingReceiveJobId); }}
                      sx={{ textTransform: 'none' }}
                    >
                      Try again
                    </Button>
                  </Box>
                )}
                {receiveBriefModel && !receiveBriefModel.ok && (
                  <Typography variant="caption" color="text.secondary">
                    {receiveBriefModel.reason === 'no_lines'
                      ? 'This receive has no products to count.'
                      : 'This receive has changed. Reload the page to see its current state.'}
                  </Typography>
                )}
                {receiveBriefModel?.ok && (
                  <>
                    <Typography variant="body2" fontWeight={600}>
                      {plural(receiveBriefModel.lineCount, 'product')} · {plural(receiveBriefModel.expectedUnits, 'unit')} expected · {receiveBriefModel.remainingUnits} remaining
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Count good, usable units only. Set damaged items aside — you'll record them at review.
                    </Typography>
                  </>
                )}
              </Box>
            )}
            {canStartReceiveDispatch && isReceiveEligible && (
              !canManageReceiveAssignment ? (
                <Typography variant="caption" color="text.secondary">
                  Only owners and admins can assign receives.
                </Typography>
              ) : receiveAssigneesStatus === 'error' ? (
                <Typography variant="body2" color="error">
                  Couldn't load who can receive this.
                </Typography>
              ) : receiveAssigneesStatus !== 'loading' && !soleSelfEligible && teamAssignableOperators.length === 0 ? (
                <Typography variant="caption" color="text.secondary">
                  No one on your team can receive this yet.
                </Typography>
              ) : null
            )}
            {receiveSlow && (
              <Typography variant="caption" color="text.secondary" role="status">
                Still working. Your click registered, so there's no need to click again or refresh.
              </Typography>
            )}
            {!cancelAllowed && (
              <Typography id={`cancel-po-unavailable-${po.id}`} variant="caption" color="text.secondary">
                Cancel is unavailable while this PO has Receive work.
              </Typography>
            )}
            {receiveDispatchError && (
              <Alert severity="error" sx={{ mt: 0.5 }}>
                {receiveDispatchError}
              </Alert>
            )}
          </Box>
        {OPEN_STATUSES.includes(po.status) && (
          // WS-UX-01 S4 — one right-aligned action group: Cancel PO… then the
          // primary. Same placement in every state; it wraps as a unit.
          <Box
            role="group"
            aria-label="PO actions"
            data-testid="po-next-step-actions"
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              flexWrap: 'nowrap',
              gap: '10px',
              ml: 'auto',
              flex: '0 0 auto',
              maxWidth: '100%',
              '& .MuiButton-root': { minHeight: 44, borderRadius: '8px', whiteSpace: 'nowrap' },
              // WS-UX-01 S5-B — narrow: full-width, primary above Cancel PO… (DOM order matches).
              ...(narrow ? { flexDirection: 'column', alignItems: 'stretch', ml: 0, width: '100%', '& .MuiButton-root': { minHeight: 44, borderRadius: '8px', whiteSpace: 'normal', width: '100%' } } : null),
            }}
          >
            {!narrow && cancelPoButton}
            {/* WS-UX-01 S1 — Draft: the merchant confirms they sent it externally (draft → ordered). */}
            {nextAction.kind === 'mark_sent' && (
              <Button
                size="small"
                variant="contained"
                disabled={updatingStatus}
                onClick={() => void handleStatusUpdate('ordered')}
                sx={{
                  textTransform: 'none',
                  bgcolor: 'var(--accent)',
                  color: 'var(--accent-ink)',
                  '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
                }}
              >
                Mark as sent
              </Button>
            )}
            {/* On the way → mark as arrived at dock */}
            {nextAction.kind === 'mark_arrived' && (
              <Button
                size="small"
                variant="contained"
                disabled={updatingStatus}
                onClick={() => void handleStatusUpdate('shipped')}
                sx={{
                  textTransform: 'none',
                  bgcolor: 'var(--accent)',
                  color: 'var(--accent-ink)',
                  '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
                }}
              >
                Mark as arrived
              </Button>
            )}
            {/* GH-1143 / WS-UX-01 S2 — only owners/admins get an enabled Reassign. */}
            {canReassignExistingReceive && (
              <Button
                ref={assignButtonRef}
                size="small"
                variant="outlined"
                aria-haspopup="dialog"
                disabled={
                  !canManageReceiveAssignment ||
                  !onReassignReceiveJob ||
                  !receiveRosterReady ||
                  receiveBusy ||
                  updatingStatus
                }
                onClick={() => handleOpenAssignPopover('reassign')}
                sx={{ textTransform: 'none' }}
              >
                {receiveMutation === 'pending' ? 'Reassigning…' : receiveMutation === 'reconciling' ? 'Checking…' : 'Reassign'}
              </Button>
            )}
            {/* GH-1245 — own started job → resume that exact job in WMS. Never claims. */}
            {receiveJobStarted && isReceiveEligible && (
              <Button
                size="small"
                variant="contained"
                disabled={updatingStatus}
                startIcon={<CheckCircle size={14} />}
                onClick={handleOpenOwnReceive}
                sx={{ bgcolor: 'var(--accent)', color: 'var(--accent-ink)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}
              >
                Resume Receive
              </Button>
            )}
            {/* WS-UX-01 S3 — explicit Start receiving for the inline brief. */}
            {canOpenOwnReceive && !receiveJobStarted && isReceiveEligible && (
              <Button
                size="small"
                variant="contained"
                disabled={
                  !receiveBriefModel?.ok ||
                  !onClaimReceiveJob ||
                  receiveBusy ||
                  updatingStatus
                }
                onClick={() => void handleStartReceive()}
                sx={{ textTransform: 'none', bgcolor: 'var(--accent)', color: 'var(--accent-ink)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}
              >
                {receiveMutation === 'pending' ? 'Starting…' : receiveMutation === 'reconciling' ? 'Checking…' : 'Start receiving'}
              </Button>
            )}
            {/* WS-UX-01 S2 — arrived, no active job (or legacy unassigned pending). */}
            {canStartReceiveDispatch && isReceiveEligible && (
              !canManageReceiveAssignment ? (
                <Button size="small" variant="contained" disabled sx={{ textTransform: 'none' }}>
                  Assign receive
                </Button>
              ) : receiveAssigneesStatus === 'loading' ? (
                <Button size="small" variant="contained" disabled sx={{ textTransform: 'none' }}>
                  Loading team…
                </Button>
              ) : receiveAssigneesStatus === 'error' ? (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => onRetryReceiveAssignees?.()}
                  sx={{ textTransform: 'none' }}
                >
                  Try again
                </Button>
              ) : soleSelfEligible ? (
                <Button
                  size="small"
                  variant="contained"
                  disabled={receiveBusy || updatingStatus}
                  onClick={() => { if (currentUserId != null) void handleDispatchReceive(currentUserId); }}
                  sx={{ textTransform: 'none', bgcolor: 'var(--accent)', color: 'var(--accent-ink)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}
                >
                  {receiveMutation === 'pending' ? 'Assigning…' : receiveMutation === 'reconciling' ? 'Checking…' : 'Receive myself'}
                </Button>
              ) : teamAssignableOperators.length === 0 ? (
                <Button size="small" variant="contained" disabled sx={{ textTransform: 'none' }}>
                  Assign receive
                </Button>
              ) : (
                <Button
                  ref={assignButtonRef}
                  size="small"
                  variant="contained"
                  aria-haspopup="dialog"
                  aria-expanded={assignAnchor ? 'true' : undefined}
                  disabled={receiveBusy || updatingStatus}
                  endIcon={<ChevronDown size={14} />}
                  onClick={() => handleOpenAssignPopover('assign')}
                  sx={{ textTransform: 'none', bgcolor: 'var(--accent)', color: 'var(--accent-ink)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}
                >
                  {receiveMutation === 'pending' ? 'Assigning…' : receiveMutation === 'reconciling' ? 'Checking…' : 'Assign receive'}
                </Button>
              )
            )}
            {narrow && cancelPoButton}
          </Box>
        )}
        </Box>
      )}

        {/* WS-UX-01 S2 — compact assignment popover. Nobody is preselected;
            picking a row is the explicit dispatch decision. */}
        <Popover
          open={assignAnchor != null}
          anchorEl={assignAnchor}
          onClose={() => setAssignAnchor(null)}
          // WS-UX-01 S4 — the Next step primary sits bottom-right; open above it.
          anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
          transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          slotProps={{ paper: { sx: { width: 280, p: 1, mt: -1 } } }}
        >
          <Typography
            id={`assign-receive-title-${po.id}`}
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', px: 1, pt: 0.5, pb: 0.75, textTransform: 'uppercase', letterSpacing: '0.06em' }}
          >
            {assignMode === 'reassign' ? 'Reassign to' : 'Assign receive to'}
          </Typography>
          {assignMode === 'assign' && receiveDispatchAssignmentSpotlight && (
            <Box sx={{ px: 1, pb: 0.75 }}>
              <SpotlightCoachMark
                title="Assign Receive work"
                body={'Assignment sends the work to Warehouse → Operations → Receiving; it does not start the job. The assigned operator opens it there and claims & starts Receive.'}
                isDismissed={receiveDispatchAssignmentSpotlight.isDismissed}
                onDismiss={receiveDispatchAssignmentSpotlight.dismiss}
              />
            </Box>
          )}
          <Box role="list" aria-labelledby={`assign-receive-title-${po.id}`} sx={{ display: 'grid', gap: 0.25 }}>
            {assignPopoverOperators.map((operator) => {
              const isSelf = operator.id === currentUserId;
              return (
                <Box role="listitem" key={operator.id}>
                  <Button
                    fullWidth
                    disabled={receiveBusy}
                    onClick={() =>
                      void (assignMode === 'reassign'
                        ? handleReassignReceive(operator.id)
                        : handleDispatchReceive(operator.id))
                    }
                    sx={{ justifyContent: 'flex-start', textAlign: 'left', textTransform: 'none', color: 'var(--ink)', px: 1, py: 0.75 }}
                  >
                    <Box>
                      <Typography variant="body2" fontWeight={600}>
                        {isSelf ? `Me · ${operator.name}` : operator.name}
                      </Typography>
                      {operator.role && (
                        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>
                          {operator.role}
                        </Typography>
                      )}
                    </Box>
                  </Button>
                </Box>
              );
            })}
          </Box>
        </Popover>

        {/* WS-UX-01 S1 — named, explicit Cancel PO confirmation. */}
        <EntityDetailModal
          entityId={cancelConfirmOpen ? po.id : null}
          onClose={handleCloseCancelConfirm}
          title={`Cancel ${poDisplay}?`}
          subtitle={po.supplier_name}
          maxWidth="md"
          footerActions={
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap', [COARSE_POINTER]: { '& .MuiButton-root': { minHeight: 44 } } }}>
              <Button
                variant="outlined"
                onClick={handleCloseCancelConfirm}
                disabled={cancellingPo}
                sx={{ textTransform: 'none', color: 'var(--ink-3)', borderColor: 'var(--rule)' }}
              >
                Keep PO
              </Button>
              <Button
                variant="contained"
                color="error"
                disableElevation
                disabled={!cancelAllowed || cancellingPo}
                onClick={() => void handleConfirmCancelPo()}
                sx={{ textTransform: 'none' }}
              >
                {cancellingPo ? 'Cancelling…' : 'Cancel PO'}
              </Button>
            </Box>
          }
        >
          <Box sx={{ p: 2.5 }}>
            <Typography variant="body2">
              Your supplier isn't notified, and you can't undo this.
            </Typography>
            {cancelError && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {cancelError}
              </Alert>
            )}
          </Box>
        </EntityDetailModal>
    </Box>
  );
};

function SupplierFormDialog({ open, mode, initial, onClose, onSubmit }: {
  open: boolean;
  mode: 'add' | 'edit';
  initial?: Supplier;
  onClose: () => void;
  onSubmit: (input: CreateSupplierInput) => Promise<void>;
}) {
  const [form, setForm] = useState({ name: '', contact_name: '', contact_email: '', contact_phone: '', moq: '', lead_time_days: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm({
        name: initial?.name ?? '',
        contact_name: initial?.contact_name ?? '',
        contact_email: initial?.contact_email ?? '',
        contact_phone: initial?.contact_phone ?? '',
        moq: initial?.moq != null ? String(initial.moq) : '',
        lead_time_days: initial?.lead_time_days != null ? String(initial.lead_time_days) : '',
      });
      setError(null);
    }
  }, [open, initial]);

  const handleSave = async () => {
    if (!form.name.trim()) return setError('Name is required.');
    setSubmitting(true);
    try {
      await onSubmit({
        name: form.name.trim(),
        contact_name: form.contact_name.trim() || undefined,
        contact_email: form.contact_email.trim() || undefined,
        contact_phone: form.contact_phone.trim() || undefined,
        moq: form.moq.trim() ? Number(form.moq) : undefined,
        lead_time_days: form.lead_time_days.trim() ? Number(form.lead_time_days) : undefined,
      });
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Failed to save supplier.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth sx={{ '@media (pointer: coarse)': { '& .MuiButton-root': { minHeight: 44 }, '& .MuiInputBase-root': { minHeight: 44 } } }}>
      <DialogTitle>{mode === 'add' ? 'Add supplier' : 'Edit supplier'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField label="Name *" size="small" fullWidth value={form.name}
          onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
        <TextField label="Contact name" size="small" fullWidth value={form.contact_name}
          onChange={(e) => setForm((p) => ({ ...p, contact_name: e.target.value }))} />
        <TextField label="Email" size="small" fullWidth value={form.contact_email}
          onChange={(e) => setForm((p) => ({ ...p, contact_email: e.target.value }))} />
        <TextField label="Phone" size="small" fullWidth value={form.contact_phone}
          onChange={(e) => setForm((p) => ({ ...p, contact_phone: e.target.value }))} />
        <TextField label="Min order qty (MOQ)" type="number" size="small" fullWidth value={form.moq}
          onChange={(e) => setForm((p) => ({ ...p, moq: e.target.value }))}
          helperText="Units this supplier requires per order. Leave blank for no minimum." />
        <TextField label="Lead time (days)" type="number" size="small" fullWidth value={form.lead_time_days}
          onChange={(e) => setForm((p) => ({ ...p, lead_time_days: e.target.value }))}
          helperText="Days from PO sent to goods received. Used to compute the best reorder date." />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">Cancel</Button>
        <Button onClick={handleSave} disabled={submitting} variant="contained"
          sx={{ bgcolor: 'var(--accent)', color: 'var(--accent-ink)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}>
          {mode === 'add' ? 'Add supplier' : 'Save changes'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─────────────────────────────────────────────
// SUPPLIER ACCORDION
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// MAIN MODULE
// ─────────────────────────────────────────────

export type PoLifecycleStep = { label: string; when: string; state: 'done' | 'current' | 'upcoming' | 'stopped' };

/**
 * WS-UX-01 S4 — Draft → On the way → Arrived, derived only from the canonical
 * PO status and its stored dates. The PO's own stage is current; earlier
 * stages are done; later ones upcoming. Arrived stays current through
 * receiving (incl. partially received) and is done only once the PO is
 * Received. Overdue annotates On the way and never activates Arrived. A
 * cancelled PO stops: no stage is shown as completed, because the projection
 * does not record where it stopped.
 */
export function resolvePoLifecycleSteps(po: PurchaseOrder): PoLifecycleStep[] {
  const shortDate = (value?: string | null) => formatShortDate(value)?.replace(/ \d{4}$/, '') ?? null;
  const created = shortDate(po.created_at);
  const createdWhen = created ? `Created ${created}` : 'Created';
  if (po.status === 'cancelled') {
    return [
      { label: 'Draft', when: createdWhen, state: 'stopped' },
      { label: 'On the way', when: 'Cancelled', state: 'stopped' },
      { label: 'Arrived', when: '—', state: 'stopped' },
    ];
  }
  const stage = po.status === 'draft' ? 0 : poListGroupOf(po) === 'on_the_way' ? 1 : 2;
  const terminal = po.status === 'received';
  const due = shortDate(po.expected_delivery_date);
  const arrived = shortDate(po.actual_delivery_date);
  const onTheWayWhen = stage === 0
    ? 'Not yet'
    : stage === 1
      ? due ? (isPoOverdue(po) ? `Overdue · ${due}` : `Due ${due}`) : 'Sent'
      : 'Sent';
  const arrivedWhen = stage < 2 ? 'Not yet' : terminal ? 'Received' : arrived ? `Arrived ${arrived}` : 'Arrived';
  const whens = [createdWhen, onTheWayWhen, arrivedWhen];
  return ['Draft', 'On the way', 'Arrived'].map((label, i) => ({
    label,
    when: whens[i],
    state: i < stage || (i === stage && terminal) ? 'done' : i === stage ? 'current' : 'upcoming',
  }));
}

/** Informational only: no step is interactive. */
function PoLifecycleSteps({ po, compact = false }: { po: PurchaseOrder; compact?: boolean }) {
  const steps = resolvePoLifecycleSteps(po);
  const cancelled = po.status === 'cancelled';
  return (
    <Box
      component="ol"
      aria-label={cancelled ? 'PO progress (cancelled)' : 'PO progress'}
      data-testid="po-lifecycle"
      sx={{
        listStyle: 'none', m: 0, display: 'flex', alignItems: 'center', gap: '14px', px: '28px', py: '12px', borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)',
        // WS-UX-01 S5-B — narrow: the three stages stack vertically, full text.
        ...(compact ? { flexDirection: 'column', alignItems: 'flex-start', gap: '10px', px: '16px' } : null),
      }}
    >
      {steps.map((step, i) => {
        const done = step.state === 'done';
        const current = step.state === 'current';
        return (
          <Fragment key={step.label}>
            {i > 0 && !compact && (
              <Box
                component="li"
                aria-hidden="true"
                sx={{ flex: 1, height: '1px', minWidth: 16, bgcolor: done ? 'var(--good-ink)' : 'var(--rule)', opacity: done ? 0.5 : 1 }}
              />
            )}
            <Box
              component="li"
              aria-current={current ? 'step' : undefined}
              data-step-state={step.state}
              sx={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 'none' }}
            >
              <Box
                component="span"
                sx={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--good-ink)',
                  bgcolor: done ? 'color-mix(in srgb, var(--good-ink) 16%, transparent)' : current ? 'var(--accent-ghost)' : 'transparent',
                  boxShadow: done ? 'none' : `inset 0 0 0 1px ${current ? 'var(--accent-border)' : 'var(--rule)'}`,
                }}
              >
                {done && <CheckCircle size={14} aria-hidden="true" />}
                {current && (
                  <Box
                    component="span"
                    data-pulse="true"
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      bgcolor: 'var(--accent)',
                      '@keyframes poStepPulse': {
                        '0%': { boxShadow: '0 0 0 0 rgba(255, 107, 43, 0.5)' },
                        '70%, 100%': { boxShadow: '0 0 0 6px rgba(255, 107, 43, 0)' },
                      },
                      '@media (prefers-reduced-motion: no-preference)': {
                        animation: 'poStepPulse 2.4s ease-out infinite',
                      },
                    }}
                  />
                )}
              </Box>
              <Box component="span" sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <Box component="span" sx={{ fontSize: 13, fontWeight: 500, lineHeight: 1, color: done || current ? 'var(--ink)' : 'var(--ink-3)' }}>
                  {step.label}
                  <Box component="span" sx={visuallyHiddenSx}>
                    {done ? ' (done)' : current ? ' (next)' : step.state === 'stopped' ? ' (not completed)' : ''}
                  </Box>
                </Box>
                <Box component="span" sx={{ fontSize: 12, lineHeight: 1, color: step.when.startsWith('Overdue') ? 'var(--warning-text)' : 'var(--ink-3)' }}>
                  {step.when}
                </Box>
              </Box>
            </Box>
          </Fragment>
        );
      })}
    </Box>
  );
}

// Explicit px: MUI sx treats numeric sizes <= 1 as percentages (1 → 100%),
// which made these spans as tall as the content box and scrolled the page.
const visuallyHiddenSx = {
  position: 'absolute', width: '1px', height: '1px', p: 0, m: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
} as const;

type PoListGroupKey = 'arrived' | 'on_the_way' | 'draft';

const PO_LIST_GROUPS: Array<{ key: PoListGroupKey; label: string }> = [
  { key: 'arrived', label: 'Arrived' },
  { key: 'on_the_way', label: 'On the way' },
  { key: 'draft', label: 'Drafts' },
];

function poListGroupOf(po: PurchaseOrder): PoListGroupKey | null {
  if (po.status === 'shipped' || po.status === 'partially_received') return 'arrived';
  if (po.status === 'ordered' || po.status === 'confirmed' || po.status === 'in_production') return 'on_the_way';
  if (po.status === 'draft') return 'draft';
  return null;
}

/** WS-UX-01 S4 — canonical PO lifecycle label (never the Receive job state). */
function poStatusLabel(po: PurchaseOrder): string {
  return po.status === 'partially_received' ? 'Partially received' : STATUS_CONFIG[po.status].label;
}

/** The assignee as the projection names it; an id only when no name exists. */
function poAssigneeLabel(po: PurchaseOrder): string | null {
  const name = po.receive_assigned_operator_name?.trim();
  if (name) return name;
  return po.receive_assigned_operator_id != null ? `Operator #${po.receive_assigned_operator_id}` : null;
}

export type PoRowLabels = {
  status: string;
  overdue: boolean;
  assignment: { label: string; tone: 'accent' | 'ink' | 'muted' };
};

/**
 * WS-UX-01 S4 — two-line list row, from the canonical PO projection only (no
 * per-row job reads). The top line is the PO lifecycle status; the bottom
 * line is the Receive assignment. "Receiving" requires an active started job.
 */
export function resolvePoRowLabels(po: PurchaseOrder, currentUserId: number | null): PoRowLabels {
  const status = poStatusLabel(po);
  const overdue = isPoOverdue(po);
  const group = poListGroupOf(po);
  const assignee = poAssigneeLabel(po);
  let assignment: PoRowLabels['assignment'];
  if (group === 'arrived') {
    const action = resolveReceiveAction(po, currentUserId);
    if (hasStartedReceive(po)) assignment = { label: assignee ? `Receiving: ${assignee}` : 'Receiving', tone: 'accent' };
    else if (action === 'assign') assignment = { label: 'Not assigned', tone: 'accent' };
    else if (po.receive_job_id != null && assignee) assignment = { label: `Assigned: ${assignee}`, tone: 'ink' };
    else assignment = { label: 'Receive state unknown', tone: 'muted' };
  } else if (po.status === 'received') {
    assignment = { label: 'Receive complete', tone: 'muted' };
  } else if (po.status === 'cancelled') {
    assignment = { label: 'No receive', tone: 'muted' };
  } else {
    assignment = { label: 'Receive not started', tone: 'muted' };
  }
  return { status, overdue, assignment };
}

function PoListRow({ po, selected, disabled, currentUserId, onSelect }: {
  po: PurchaseOrder;
  selected: boolean;
  disabled: boolean;
  currentUserId: number | null;
  onSelect: (poId: string) => void;
}) {
  const labels = resolvePoRowLabels(po, currentUserId);
  const group = poListGroupOf(po);
  const dot = group === 'arrived' ? 'var(--accent)' : group === 'on_the_way' ? 'var(--ink-3)' : 'var(--ink-4)';
  const toneColor = { accent: 'var(--accent-text)', ink: 'var(--ink-2)', muted: 'var(--ink-3)' }[labels.assignment.tone];
  const due = formatShortDate(po.expected_delivery_date)?.replace(/ \d{4}$/, '');
  const identity = `${po.supplier_name} · ${formatPoDisplay(po)} · ${labels.status} · ${labels.assignment.label}`;
  // WS-UX-01 S4 — the app's MUI Tooltip (as in WarehouseGrid BinCell) shows
  // the full identity of a truncated row. The span keeps it working while the
  // row is disabled by a claim hold.
  return (
    <Tooltip title={identity} placement="right" enterDelay={400} arrow>
      <Box component="span" sx={{ display: 'flex', flexDirection: 'column' }}>
        <Box
          component="button"
          type="button"
          data-testid={`po-row-${po.id}`}
          aria-current={selected ? 'true' : undefined}
          disabled={disabled && !selected}
          onClick={() => onSelect(po.id)}
          sx={{
            all: 'unset',
            boxSizing: 'border-box',
            display: 'grid',
            gridTemplateColumns: '7px minmax(0, 1fr) auto',
            alignItems: 'center',
            columnGap: '10px',
            rowGap: '3px',
            mx: '6px',
            px: '14px',
            py: '8px',
            borderRadius: '8px',
            cursor: disabled && !selected ? 'not-allowed' : 'pointer',
            bgcolor: selected ? 'var(--accent-ghost)' : 'transparent',
            boxShadow: selected ? 'inset 0 0 0 1px var(--accent-border)' : 'none',
            opacity: disabled && !selected ? 0.5 : 1,
            '&:hover': selected || disabled ? undefined : { bgcolor: 'var(--bg-2)' },
            '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '-2px' },
          }}
        >
          <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: dot }} />
          <Box component="span" sx={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.25, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {po.supplier_name}
          </Box>
          <Box component="span" data-testid="po-row-status" sx={{ fontSize: 12, lineHeight: 1.2, color: 'var(--ink-2)', textAlign: 'right', whiteSpace: 'nowrap' }}>
            {labels.status}
            {labels.overdue && (
              <Box component="span" sx={{ color: 'var(--warning-text)', fontWeight: 500 }}>
                {` · Overdue${due ? ` ${due}` : ''}`}
              </Box>
            )}
          </Box>
          <Box component="span" />
          <Box component="span" sx={{ fontSize: 12, lineHeight: 1.2, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {formatPoDisplay(po)} · {plural(Number(po.total_units_ordered) || 0, 'unit')}
          </Box>
          <Box
            component="span"
            data-testid="po-row-assignment"
            sx={{ fontSize: 12, lineHeight: 1.2, textAlign: 'right', whiteSpace: 'nowrap', maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', color: toneColor, fontWeight: labels.assignment.tone === 'accent' ? 500 : 400 }}
          >
            {labels.assignment.label}
          </Box>
        </Box>
      </Box>
    </Tooltip>
  );
}

type PoStatusFilter = 'all' | 'draft' | 'on_the_way' | 'shipped' | 'partially_received' | 'received' | 'cancelled';
type PoAssignmentFilter = 'any' | 'unassigned' | 'mine' | 'others' | 'receiving';

const PO_STATUS_FILTERS: Array<[PoStatusFilter, string]> = [
  ['all', 'All statuses'], ['draft', 'Draft'], ['on_the_way', 'On the way'], ['shipped', 'Arrived'],
  ['partially_received', 'Partially received'], ['received', 'Received'], ['cancelled', 'Cancelled'],
];
const PO_ASSIGNMENT_FILTERS: Array<[PoAssignmentFilter, string]> = [
  ['any', 'Any receive'], ['unassigned', 'Not assigned'], ['mine', 'Assigned to me'],
  ['others', 'Assigned to others'], ['receiving', 'Receiving'],
];

/** WS-UX-01 S4 — in-memory list filtering over the existing projection. */
export function poMatchesFilters(
  po: PurchaseOrder,
  filters: { search: string; status: PoStatusFilter; assignment: PoAssignmentFilter },
  currentUserId: number | null
): boolean {
  const query = filters.search.trim().toLowerCase();
  if (query) {
    const haystack = [po.supplier_name, formatPoDisplay(po), String(po.po_number ?? '')].join(' ').toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (filters.status !== 'all') {
    const matches = filters.status === 'on_the_way' ? poListGroupOf(po) === 'on_the_way' : po.status === filters.status;
    if (!matches) return false;
  }
  switch (filters.assignment) {
    case 'unassigned':
      return poListGroupOf(po) === 'arrived' && resolveReceiveAction(po, currentUserId) === 'assign';
    case 'mine':
      return po.receive_job_id != null && currentUserId != null && po.receive_assigned_operator_id === currentUserId;
    case 'others':
      return po.receive_job_id != null && po.receive_assigned_operator_id != null && po.receive_assigned_operator_id !== currentUserId;
    case 'receiving':
      return hasStartedReceive(po);
    default:
      return true;
  }
}

type PoListView = 'open' | 'closed';
type PoSortKey = 'default' | 'newest' | 'expected' | 'supplier';

const PO_SORTS: Array<[PoSortKey, string]> = [
  ['default', 'Default order'],
  ['newest', 'Newest first'],
  ['expected', 'Expected date soonest'],
  ['supplier', 'Supplier A–Z'],
];

const PO_CLOSED_GROUPS: Array<{ key: 'received' | 'cancelled'; label: string }> = [
  { key: 'received', label: 'Received' },
  { key: 'cancelled', label: 'Cancelled' },
];

/**
 * WS-UX-01 S4 — stable, deterministic list sort inside a group. "default"
 * keeps the API order; missing or malformed dates sort last; ties keep the
 * API order.
 */
export function sortPurchaseOrders(pos: PurchaseOrder[], key: PoSortKey): PurchaseOrder[] {
  if (key === 'default') return pos;
  const time = (value: string | null | undefined) => {
    const t = key === 'expected' ? parseCalendarDate(value)?.getTime() : value ? Date.parse(value) : NaN;
    return t == null || Number.isNaN(t) ? null : t;
  };
  const compare = (a: PurchaseOrder, b: PurchaseOrder): number => {
    if (key === 'supplier') return (a.supplier_name ?? '').localeCompare(b.supplier_name ?? '', undefined, { sensitivity: 'base' });
    const ta = time(key === 'newest' ? a.created_at : a.expected_delivery_date);
    const tb = time(key === 'newest' ? b.created_at : b.expected_delivery_date);
    if (ta == null || tb == null) return ta == null ? (tb == null ? 0 : 1) : -1;
    return key === 'newest' ? tb - ta : ta - tb;
  };
  return pos
    .map((po, index) => ({ po, index }))
    .sort((x, y) => compare(x.po, y.po) || x.index - y.index)
    .map(({ po }) => po);
}

/** WS-UX-01 S5-B — below this measured workspace width Purchasing shows one pane. */
export const NARROW_WORKSPACE_PX = 880;
/** WS-UX-01 S5-B — touch devices get >= 44px targets; fine pointers keep S4 density. */
const COARSE_POINTER = '@media (pointer: coarse)';
const COARSE_MENU_SX = { [COARSE_POINTER]: { '& .MuiMenuItem-root': { minHeight: 44 } } } as const;

const LIST_TOOL_SX = {
  [COARSE_POINTER]: { minHeight: 44 },
  minHeight: 32,
  px: 1.25,
  fontSize: 12.5,
  textTransform: 'none',
  color: 'var(--ink-2)',
  borderColor: 'var(--rule)',
  borderRadius: '6px',
  whiteSpace: 'nowrap',
  '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '1px' },
} as const;

/** Thin, unobtrusive native scrollbar; wheel, trackpad and keyboard scrolling unchanged. */
const THIN_SCROLL_SX = {
  scrollbarWidth: 'thin',
  scrollbarColor: 'var(--rule) transparent',
  '&::-webkit-scrollbar': { width: 8, height: 8 },
  '&::-webkit-scrollbar-thumb': { backgroundColor: 'var(--rule)', borderRadius: 8 },
  '&::-webkit-scrollbar-track': { background: 'transparent' },
} as const;

function PurchasingPosView({
  data, isLoading, isError, onRefresh,
  onFetchLineItems, onUpdatePoStatus, onCreatePo,
  onCreateReceiveJob, onReassignReceiveJob, onSearchVariants, autoOpenCreatePo = false,
  autoOpenReceivePoId, prefilledLineItem,
  teamAssignableOperators = [], currentUserId = null,
  receiveAssigneesStatus = 'ready', onRetryReceiveAssignees,
  canManageReceiveAssignment = false, onReconcilePurchaseOrders,
  onFetchReceiveJob, onClaimReceiveJob,
  spotlights,
}: SuppliersPortalPageProps) {
  const [createPoOpen, setCreatePoOpen] = useState(autoOpenCreatePo);
  const [searchParams, setSearchParams] = useSearchParams();
  // WS-UX-01 S4 D1 — a Start receiving claim in flight holds the selection.
  const [claimHoldPoId, setClaimHoldPoId] = useState<string | null>(null);
  // WS-UX-01 S4 D1 — details mount on first selection and stay mounted.
  const mountedPoIdsRef = useRef<Set<string>>(new Set());

  // WS-UX-01 S4 — Open/Closed is navigation: the view is the selected PO's
  // view, and switching selects that view's remembered (or first) PO. Only an
  // empty view is held here. Filters and sort only choose which rows show and
  // in which order; they never touch selection, the claim hold or the mounted
  // details.
  const [emptyView, setEmptyView] = useState<PoListView | null>(null);
  const lastSelectedRef = useRef<Record<PoListView, string | null>>({ open: null, closed: null });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<PoStatusFilter>('all');
  const [assignmentFilter, setAssignmentFilter] = useState<PoAssignmentFilter>('any');
  const [sortKey, setSortKey] = useState<PoSortKey>('default');
  const [filtersAnchor, setFiltersAnchor] = useState<HTMLElement | null>(null);
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null);
  const activeFilterCount = (search.trim() ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0) + (assignmentFilter !== 'any' ? 1 : 0);
  const filtersActive = activeFilterCount > 0;
  const clearFilters = () => { setSearch(''); setStatusFilter('all'); setAssignmentFilter('any'); };

  const allPos = data?.purchase_orders ?? [];
  const suppliers = data?.suppliers ?? [];
  const openPos = allPos.filter((po) => OPEN_STATUSES.includes(po.status));
  const closedPos = allPos.filter((po) => !OPEN_STATUSES.includes(po.status));
  const groups = PO_LIST_GROUPS.map((group) => ({
    ...group,
    pos: openPos.filter((po) => poListGroupOf(po) === group.key),
  }));
  const matches = (po: PurchaseOrder) =>
    poMatchesFilters(po, { search, status: statusFilter, assignment: assignmentFilter }, currentUserId);
  const visibleOpenGroups = groups.map((group) => ({ ...group, pos: sortPurchaseOrders(group.pos.filter(matches), sortKey) }));
  const visibleClosedGroups = PO_CLOSED_GROUPS.map((group) => ({
    ...group,
    pos: sortPurchaseOrders(closedPos.filter((po) => po.status === group.key && matches(po)), sortKey),
  }));
  const visibleOpenCount = visibleOpenGroups.reduce((n, group) => n + group.pos.length, 0);
  const visibleClosedCount = visibleClosedGroups.reduce((n, group) => n + group.pos.length, 0);
  const loaded = !isLoading && !isError && data != null;
  const knownPoIds = new Set(allPos.map((po) => po.id));

  // WS-UX-01 S5-B — the measured Purchasing workspace (not the viewport)
  // decides the layout, so the sidenav width is accounted for. Until the
  // first measurement nothing is mounted, so no default detail (and no
  // line-item request) is created for a layout that then hides it.
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const canMeasure = typeof ResizeObserver !== 'undefined';
  const [workspaceWidth, setWorkspaceWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = workspaceRef.current;
    if (!el || !canMeasure) return;
    setWorkspaceWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver(() => setWorkspaceWidth(el.getBoundingClientRect().width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [canMeasure]);
  const layoutKnown = !canMeasure || workspaceWidth != null;
  // Zero width means "not laid out" (hidden ancestor, no layout engine):
  // keep the certified S4 layout rather than guess a narrow one.
  const narrow = workspaceWidth != null && workspaceWidth > 0 && workspaceWidth < NARROW_WORKSPACE_PX;

  // WS-UX-01 S4 D2/D3 — selection: a pending action=receive deep link, else
  // ?po=<id>, else the first Arrived → On the way → Draft PO (unfiltered, so
  // filters and sorting never move it). S5-B: a narrow workspace has no
  // default — without ?po it shows the list.
  const poParam = searchParams.get('po');
  const deepLinkPoId = autoOpenReceivePoId && knownPoIds.has(autoOpenReceivePoId) ? autoOpenReceivePoId : null;
  const requestedPoId = deepLinkPoId ?? (poParam && knownPoIds.has(poParam) ? poParam : null);
  const defaultPoId = groups.find((group) => group.pos.length > 0)?.pos[0]?.id ?? null;
  const selectedPoId = claimHoldPoId ?? requestedPoId ?? (narrow ? null : defaultPoId);
  if (layoutKnown && selectedPoId) mountedPoIdsRef.current.add(selectedPoId);
  const selectedPo = allPos.find((po) => po.id === selectedPoId) ?? null;
  const selectedView: PoListView | null = selectedPo ? (OPEN_STATUSES.includes(selectedPo.status) ? 'open' : 'closed') : null;
  if (selectedPoId && selectedView) lastSelectedRef.current[selectedView] = selectedPoId;
  // S5-B: in the narrow list pane, ?view=open|closed carries the list view.
  const viewParam: PoListView = searchParams.get('view') === 'closed' ? 'closed' : 'open';
  const pane: 'list' | 'detail' | null = narrow ? (selectedPoId ? 'detail' : 'list') : null;
  const listView: PoListView = pane === 'list' ? viewParam : (emptyView ?? selectedView ?? 'open');
  // A PO from the other view is never shown as the active detail.
  const displayedPoId = selectedView === listView ? selectedPoId : null;
  const displayedPo = displayedPoId != null ? selectedPo : null;

  // Any selection change (click, Back/Forward, deep link) ends an empty view.
  useEffect(() => { setEmptyView(null); }, [selectedPoId]);

  const visibleGroups = listView === 'open' ? visibleOpenGroups : visibleClosedGroups;
  const visibleCount = listView === 'open' ? visibleOpenCount : visibleClosedCount;
  const viewTotal = listView === 'open' ? openPos.length : closedPos.length;
  const selectedVisible = displayedPoId != null && visibleGroups.some((group) => group.pos.some((po) => po.id === displayedPoId));
  const statusChoices = PO_STATUS_FILTERS.filter(([value]) =>
    value === 'all' || (listView === 'closed' ? value === 'received' || value === 'cancelled' : value !== 'received' && value !== 'cancelled')
  );

  /**
   * Open/Closed navigation: select the view's last PO (if still in it), else
   * its first PO (unfiltered group order); an empty view shows its empty
   * state. A Start receiving claim holds the view with the selection.
   */
  const handleListView = (view: PoListView) => {
    if (claimHoldPoId || view === listView) return;
    // A status filter from the other view would only empty this one.
    setStatusFilter('all');
    // S5-B: the narrow list pane stays in the list; the view is a history entry.
    if (pane === 'list') {
      updateParams((params) => {
        params.set('view', view);
        params.delete('po');
        params.delete('action');
        params.delete('poId');
      }, false);
      return;
    }
    const viewPos = view === 'open'
      ? groups.flatMap((group) => group.pos)
      : PO_CLOSED_GROUPS.flatMap((group) => closedPos.filter((po) => po.status === group.key));
    const remembered = lastSelectedRef.current[view];
    const target = viewPos.find((po) => po.id === remembered)?.id ?? viewPos[0]?.id ?? null;
    if (target == null) setEmptyView(view);
    else if (target === selectedPoId) setEmptyView(null);
    else handleSelectPo(target);
  };

  /** Reveal the selected PO when filters hide it. Selection is unchanged. */
  const revealSelected = clearFilters;

  const updateParams = useCallback(
    (mutate: (params: URLSearchParams) => void, replace: boolean) => {
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        mutate(next);
        return next;
      }, { replace });
    },
    [setSearchParams]
  );

  /** A user selection is a history entry (D2). Unrelated params are kept. */
  const handleSelectPo = useCallback((poId: string) => {
    if (claimHoldPoId) return;
    updateParams((params) => {
      params.set('po', poId);
      params.delete('action');
      params.delete('poId');
      params.delete('view');
    }, false);
  }, [claimHoldPoId, updateParams]);

  /**
   * S5-B — narrow detail → list: a new history entry without po/action/poId,
   * keeping the PO's Open/Closed view. Never history.go(-1); blocked while a
   * Start receiving claim holds the selection.
   */
  const handleBackToList = () => {
    if (claimHoldPoId) return;
    const view = selectedView ?? 'open';
    updateParams((params) => {
      params.delete('po');
      params.delete('action');
      params.delete('poId');
      params.set('view', view);
    }, false);
  };

  // S5-B — on a narrow pane switch, bring the workspace top into view and
  // move focus to the new pane's anchor (Back to POs, or the PO just left).
  const previousPaneRef = useRef<{ pane: typeof pane; poId: string | null }>({ pane, poId: selectedPoId });
  const backButtonRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const previous = previousPaneRef.current;
    previousPaneRef.current = { pane, poId: selectedPoId };
    if (pane == null || previous.pane == null || previous.pane === pane) return;
    workspaceRef.current?.scrollIntoView?.({ block: 'start' });
    if (pane === 'detail') backButtonRef.current?.focus();
    else if (previous.poId) workspaceRef.current?.querySelector<HTMLElement>(`[data-testid="po-row-${previous.poId}"]`)?.focus();
  }, [pane, selectedPoId]);

  /** D3 — after the deep link ran its D5 decision, normalize to ?po=X (replace). */
  const handleDeepLinkHandled = useCallback((poId: string) => {
    updateParams((params) => {
      params.delete('action');
      params.delete('poId');
      params.set('po', poId);
    }, true);
  }, [updateParams]);

  const handleStartClaimChange = useCallback((poId: string, inFlight: boolean) => {
    setClaimHoldPoId((current) => (inFlight ? poId : current === poId ? null : current));
  }, []);

  // WS-UX-01 S4 D2/D3 — automatic normalization (replace): drop an unknown
  // ?po, drop a deep link to an unknown PO, and normalize a deep link the
  // Receive decision does not apply to. A Receive-eligible deep link is
  // normalized by its detail once evaluated.
  useEffect(() => {
    if (!loaded) return;
    const actionReceive = searchParams.get('action') === 'receive';
    const linkPoId = actionReceive ? searchParams.get('poId') : null;
    if (actionReceive) {
      const target = linkPoId ? allPos.find((po) => po.id === linkPoId) : undefined;
      if (!target) {
        updateParams((params) => { params.delete('action'); params.delete('poId'); }, true);
      } else if (target.status !== 'shipped' && target.status !== 'partially_received') {
        handleDeepLinkHandled(target.id);
      }
      return;
    }
    if (poParam && !knownPoIds.has(poParam)) {
      updateParams((params) => params.delete('po'), true);
    }
  });

  const handlePoCreated = () => {
    setCreatePoOpen(false);
    onRefresh();
  };

  const renderRow = (po: PurchaseOrder) => (
    <PoListRow
      key={po.id}
      po={po}
      selected={po.id === displayedPoId}
      disabled={claimHoldPoId != null}
      currentUserId={currentUserId}
      onSelect={handleSelectPo}
    />
  );

  const mountedPos = allPos.filter((po) => mountedPoIdsRef.current.has(po.id));
  const viewCount = (view: PoListView) => {
    const total = view === 'open' ? openPos.length : closedPos.length;
    const shown = view === 'open' ? visibleOpenCount : visibleClosedCount;
    return filtersActive ? `${shown} of ${total}` : String(total);
  };

  return (
    <Box
      ref={workspaceRef}
      data-testid="purchasing-workspace"
      data-layout={narrow ? 'narrow' : 'wide'}
      data-pane={pane ?? undefined}
      sx={{
        px: { xs: 2, md: '32px' },
        pt: '20px',
        pb: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        // WS-UX-01 S4 — fill the route's height (no viewport guess); the list
        // rows and the detail body own their scrolling. S5-B: a narrow
        // workspace uses natural page flow instead.
        '@media (min-width: 1100px)': narrow ? {} : { flex: 1, minHeight: 0 },
      }}
    >

      {/* HEADER */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <Box>
          <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2 }}>
            {listView === 'closed' ? 'Closed POs' : 'Open POs'}
          </Typography>
          {/* WS-UX-01 S4 — counts describe the active view. */}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {loaded && listView === 'closed' && closedPos.length > 0
              ? PO_CLOSED_GROUPS.map((group) => `${closedPos.filter((po) => po.status === group.key).length} ${group.label.toLowerCase()}`).join(' · ')
              : loaded && listView === 'open' && openPos.length > 0
              ? `${groups[0].pos.length} arrived · ${groups[1].pos.length} on the way · ${plural(groups[2].pos.length, 'draft')}`
              : 'Purchase orders and ETAs.'}
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Plus size={16} />}
          onClick={() => setCreatePoOpen(true)}
          sx={{ bgcolor: 'var(--accent)', color: 'var(--accent-ink)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}
        >
          New PO
        </Button>
      </Box>

      {isLoading && <ModuleLoadingSkeleton />}

      {isError && (
        <Alert severity="error">
          Failed to load supplier data. Please refresh.
        </Alert>
      )}

      {loaded && allPos.length === 0 && (
        <Paper variant="outlined" sx={{ textAlign: 'center', py: 6, borderRadius: 2, borderStyle: 'dashed' }}>
          <Truck size={36} style={{ opacity: 0.3 }} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            No open purchase orders.
          </Typography>
          <Button
            size="small"
            startIcon={<Plus size={14} />}
            sx={{ mt: 2 }}
            onClick={() => setCreatePoOpen(true)}
          >
            Create your first PO
          </Button>
        </Paper>
      )}

      {/* WS-UX-01 S4 — PO list beside the selected PO (D5: one column below ~1100px).
          S5-B — below 880px of workspace: one pane, list OR detail. */}
      {loaded && allPos.length > 0 && layoutKnown && (
        <Box
          sx={narrow ? { display: 'grid', gap: '12px', gridTemplateColumns: 'minmax(0, 1fr)' } : {
            display: 'grid',
            gap: '20px',
            gridTemplateColumns: 'minmax(0, 1fr)',
            '@media (min-width: 1100px)': {
              gridTemplateColumns: '372px minmax(0, 1fr)',
              flex: 1,
              minHeight: 0,
            },
          }}
        >
          <Box
            component="nav"
            aria-label="Purchase orders"
            hidden={pane === 'detail'}
            sx={{
              minHeight: 0,
              display: pane === 'detail' ? 'none' : 'flex',
              flexDirection: 'column',
              border: '1px solid var(--rule)',
              borderRadius: '12px',
              bgcolor: 'var(--surface)',
              overflow: 'hidden',
            }}
          >
            {/* Toolbar: search · Filters · Sort, then Open / Closed. Never scrolls. */}
            <Box sx={{ flexShrink: 0, px: '10px', pt: '10px', pb: '8px', display: 'grid', gap: '8px', borderBottom: '1px solid var(--rule)' }}>
              <Box role="search" aria-label="Filter purchase orders" sx={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <TextField
                  size="small"
                  placeholder="Search PO or supplier…"
                  inputProps={{ 'aria-label': 'Search PO or supplier' }}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  sx={{ flex: 1, minWidth: 0, '& .MuiInputBase-root': { height: 32, fontSize: 13, [COARSE_POINTER]: { height: 44, '& .MuiInputBase-input': { height: '100%', py: 0, boxSizing: 'border-box' } } } }}
                />
                <Button
                  variant="outlined"
                  aria-haspopup="menu"
                  aria-expanded={filtersAnchor ? 'true' : undefined}
                  onClick={(e) => setFiltersAnchor(e.currentTarget)}
                  sx={{
                    ...LIST_TOOL_SX,
                    ...((statusFilter !== 'all' || assignmentFilter !== 'any') && { color: 'var(--accent-text)', borderColor: 'var(--accent-border)', bgcolor: 'var(--accent-ghost)' }),
                  }}
                >
                  {statusFilter !== 'all' || assignmentFilter !== 'any'
                    ? `Filters · ${(statusFilter !== 'all' ? 1 : 0) + (assignmentFilter !== 'any' ? 1 : 0)}`
                    : 'Filters'}
                </Button>
                <Button
                  variant="outlined"
                  aria-haspopup="menu"
                  aria-label={`Sort: ${PO_SORTS.find(([key]) => key === sortKey)?.[1]}`}
                  aria-expanded={sortAnchor ? 'true' : undefined}
                  onClick={(e) => setSortAnchor(e.currentTarget)}
                  sx={{ ...LIST_TOOL_SX, ...(sortKey !== 'default' && { color: 'var(--accent-text)', borderColor: 'var(--accent-border)' }) }}
                >
                  Sort
                </Button>
              </Box>
              <Menu anchorEl={filtersAnchor} open={filtersAnchor != null} onClose={() => setFiltersAnchor(null)} MenuListProps={{ dense: true, 'aria-label': 'Filters' }} slotProps={{ paper: { sx: COARSE_MENU_SX } }}>
                <ListSubheader sx={{ lineHeight: '28px', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>PO status</ListSubheader>
                {statusChoices.map(([value, label]) => (
                  <MenuItem key={value} role="menuitemradio" aria-checked={statusFilter === value} selected={statusFilter === value} onClick={() => setStatusFilter(value)} sx={{ fontSize: 13 }}>
                    {label}
                  </MenuItem>
                ))}
                <ListSubheader sx={{ lineHeight: '28px', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Receive</ListSubheader>
                {PO_ASSIGNMENT_FILTERS.map(([value, label]) => (
                  <MenuItem key={value} role="menuitemradio" aria-checked={assignmentFilter === value} selected={assignmentFilter === value} onClick={() => setAssignmentFilter(value)} sx={{ fontSize: 13 }}>
                    {label}
                  </MenuItem>
                ))}
                <Divider />
                <MenuItem disabled={!filtersActive} onClick={() => { clearFilters(); setFiltersAnchor(null); }} sx={{ fontSize: 13 }}>
                  Clear filters
                </MenuItem>
              </Menu>
              <Menu anchorEl={sortAnchor} open={sortAnchor != null} onClose={() => setSortAnchor(null)} MenuListProps={{ dense: true, 'aria-label': 'Sort' }} slotProps={{ paper: { sx: COARSE_MENU_SX } }}>
                {PO_SORTS.map(([value, label]) => (
                  <MenuItem key={value} role="menuitemradio" aria-checked={sortKey === value} selected={sortKey === value} onClick={() => { setSortKey(value); setSortAnchor(null); }} sx={{ fontSize: 13 }}>
                    {label}
                  </MenuItem>
                ))}
              </Menu>
              <Box role="group" aria-label="Open or closed purchase orders" sx={{ display: 'flex', gap: '4px', p: '3px', borderRadius: '8px', border: '1px solid var(--rule)' }}>
                {(['open', 'closed'] as const).map((view) => (
                  <Box
                    key={view}
                    component="button"
                    type="button"
                    aria-pressed={listView === view}
                    disabled={claimHoldPoId != null && listView !== view}
                    onClick={() => handleListView(view)}
                    sx={{
                      all: 'unset',
                      flex: 1,
                      textAlign: 'center',
                      py: '5px',
                      [COARSE_POINTER]: { minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', py: 0 },
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: 12.5,
                      fontWeight: 500,
                      // Not --bg-2: it equals --surface in dark mode (§11).
                      color: listView === view ? 'var(--ink)' : 'var(--ink-3)',
                      bgcolor: listView === view ? 'var(--accent-ghost)' : 'transparent',
                      boxShadow: listView === view ? 'inset 0 0 0 1px var(--accent-border)' : 'none',
                      '&:hover': listView === view ? undefined : { color: 'var(--ink-2)' },
                      '&:disabled': { cursor: 'not-allowed', opacity: 0.5 },
                      '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '1px' },
                    }}
                  >
                    {view === 'open' ? 'Open' : 'Closed'} ({viewCount(view)})
                  </Box>
                ))}
              </Box>
              {(filtersActive || (displayedPo && !selectedVisible)) && (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, fontSize: 12, color: 'var(--ink-3)' }}>
                  <span role="status">
                    {displayedPo && !selectedVisible
                      ? `${formatPoDisplay(displayedPo)} is selected but hidden here.`
                      : `Showing ${visibleCount} of ${viewTotal} POs`}
                  </span>
                  <Button
                    size="small"
                    onClick={displayedPo && !selectedVisible ? revealSelected : clearFilters}
                    sx={{ textTransform: 'none', minHeight: 0, py: 0, fontSize: 12 }}
                  >
                    {displayedPo && !selectedVisible ? `Show ${formatPoDisplay(displayedPo)}` : 'Clear filters'}
                  </Button>
                </Box>
              )}
            </Box>

            {/* The only scrolling region of the list. */}
            <Box
              data-testid="po-list-rows"
              sx={{
                ...THIN_SCROLL_SX,
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                py: '4px',
                display: 'flex',
                flexDirection: 'column',
                gap: '1px',
                // S5-B: the narrow list pane is the whole page; it is not capped.
                '@media (max-width: 1099.98px)': { maxHeight: narrow ? 'none' : 480 },
              }}
            >
              {visibleCount === 0 && (
                filtersActive ? (
                  <Box sx={{ px: 3, py: 3, display: 'grid', gap: 1, justifyItems: 'start' }}>
                    <Typography variant="body2" color="text.secondary">
                      No purchase orders match these filters.
                    </Typography>
                    <Button size="small" variant="outlined" onClick={clearFilters} sx={{ textTransform: 'none' }}>
                      Clear filters
                    </Button>
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary" sx={{ px: 3, py: 2 }}>
                    {listView === 'open' ? 'No open purchase orders.' : 'No received or cancelled purchase orders yet.'}
                  </Typography>
                )
              )}
              {visibleGroups.filter((group) => group.pos.length > 0).map((group) => (
                <Box key={group.key} role="group" aria-label={group.label} sx={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      px: '22px',
                      pt: '12px',
                      pb: '6px',
                      fontSize: 11,
                      fontWeight: 500,
                      lineHeight: 1,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: group.key === 'arrived' ? 'var(--accent-text)' : 'var(--ink-3)',
                    }}
                  >
                    <span>{group.label}</span>
                    <span>{group.pos.length}</span>
                  </Box>
                  {group.pos.map(renderRow)}
                </Box>
              ))}
            </Box>
          </Box>

          <Box hidden={pane === 'list'} sx={{ minHeight: 0, minWidth: 0, display: pane === 'list' ? 'none' : 'flex', flexDirection: 'column', gap: narrow ? '8px' : 0 }}>
            {/* S5-B — narrow detail pane: an explicit way back to the list. */}
            {pane === 'detail' && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <Button
                  ref={backButtonRef}
                  variant="text"
                  startIcon={<ChevronLeft size={18} />}
                  onClick={handleBackToList}
                  disabled={claimHoldPoId != null}
                  aria-describedby={claimHoldPoId != null ? 'po-back-held' : undefined}
                  sx={{ minHeight: 44, px: 1, ml: -1, textTransform: 'none', fontSize: 14, color: 'var(--ink-2)' }}
                >
                  Back to POs
                </Button>
                {claimHoldPoId != null && (
                  <Typography id="po-back-held" variant="caption" color="text.secondary">
                    Available once Start receiving finishes.
                  </Typography>
                )}
              </Box>
            )}
            {displayedPoId == null && (
              <Box sx={{ border: '1px dashed var(--rule)', borderRadius: '14px', p: 4, textAlign: 'center', color: 'var(--ink-3)' }}>
                <Typography variant="body2">
                  {viewTotal === 0
                    ? listView === 'open' ? 'No open purchase orders.' : 'No closed purchase orders yet.'
                    : 'Select a purchase order to see its details.'}
                </Typography>
              </Box>
            )}
            {/* Hidden details stay mounted: locks, caches and pending work survive. */}
            {mountedPos.map((po) => (
              <PoDetail
                key={po.id}
                po={po}
                selected={po.id === displayedPoId}
                onStartClaimChange={handleStartClaimChange}
                onDeepLinkHandled={handleDeepLinkHandled}
                onFetchLineItems={onFetchLineItems}
                onUpdatePoStatus={onUpdatePoStatus}
                onCreateReceiveJob={onCreateReceiveJob}
                onReassignReceiveJob={onReassignReceiveJob}
                teamAssignableOperators={teamAssignableOperators}
                receiveAssigneesStatus={receiveAssigneesStatus}
                onRetryReceiveAssignees={onRetryReceiveAssignees}
                canManageReceiveAssignment={canManageReceiveAssignment}
                currentUserId={currentUserId}
                onReconcilePurchaseOrders={onReconcilePurchaseOrders}
                onFetchReceiveJob={onFetchReceiveJob}
                onClaimReceiveJob={onClaimReceiveJob}
                autoOpenReceive={OPEN_STATUSES.includes(po.status) && deepLinkPoId === po.id}
                receiveDispatchAssignmentSpotlight={spotlights?.receiveDispatchAssignment}
                narrow={narrow}
              />
            ))}
          </Box>
        </Box>
      )}

      {/* CREATE PO DIALOG */}
      <CreatePoDialog
        open={createPoOpen}
        suppliers={suppliers}
        prefilledLineItem={prefilledLineItem}
        onClose={handlePoCreated}
        onCreatePo={onCreatePo}
        onSearchVariants={onSearchVariants}
      />
    </Box>
  );
}

type SupplierFilter = 'all' | 'open' | 'moq' | 'lead';
type SupplierSort = 'default' | 'name' | 'open';
const SUPPLIER_FILTERS: Array<[SupplierFilter, string]> = [
  ['all', 'All'], ['open', 'Open POs'], ['moq', 'Missing MOQ'], ['lead', 'Missing lead time'],
];
const SUPPLIER_SORTS: Array<[SupplierSort, string]> = [
  ['default', 'Default'], ['name', 'Name'], ['open', 'Open PO count'],
];

function PurchasingSuppliersView({
  data, isLoading, isError, onUpdateSupplier, onCreateSupplier, onDeleteSupplier,
}: SuppliersPortalPageProps) {
  const [params, setParams] = useSearchParams();
  const [supplierFormOpen, setSupplierFormOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<SupplierFilter>('all');
  const [sort, setSort] = useState<SupplierSort>('default');
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // CRUD callbacks refetch asynchronously. Keep returned records usable until
  // the authoritative projection catches up, and hide successfully removed rows.
  const [saved, setSaved] = useState<Supplier | null>(null);
  const [removed, setRemoved] = useState<number[]>([]);
  const suppliers = (data?.suppliers ?? []).filter((s) => !removed.includes(s.id))
    .map((s) => saved?.id === s.id ? saved : s);
  if (saved && !removed.includes(saved.id) && !suppliers.some((s) => s.id === saved.id)) suppliers.push(saved);
  useEffect(() => {
    if (saved && data?.suppliers.some((s) => s.id === saved.id &&
      s.name === saved.name && s.contact_name === saved.contact_name &&
      s.contact_email === saved.contact_email && s.contact_phone === saved.contact_phone &&
      s.moq === saved.moq && s.lead_time_days === saved.lead_time_days)) setSaved(null);
  }, [data, saved]);
  const loaded = !isLoading && !isError && data != null;
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const backRef = useRef<HTMLButtonElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const canMeasure = typeof ResizeObserver !== 'undefined';
  useLayoutEffect(() => {
    const el = workspaceRef.current;
    if (!el || !canMeasure) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [canMeasure]);
  const narrow = width != null && width > 0 && width < NARROW_WORKSPACE_PX;
  const layoutKnown = !canMeasure || width != null;
  const requested = params.get('supplier');
  const selected = suppliers.find((s) => String(s.id) === requested) ?? (narrow ? null : suppliers[0] ?? null);
  const pane = narrow ? selected ? 'detail' : 'list' : null;
  const select = (id: number | null, replace = false) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (id == null) next.delete('supplier');
      else next.set('supplier', String(id));
      return next;
    }, { replace });
  };
  useEffect(() => {
    if (loaded && requested && !suppliers.some((s) => String(s.id) === requested)) {
      // One authority repairs invalid selection. A completed deletion selects
      // a remaining record here, rather than racing navigation from its handler.
      const replacement = removed.some((id) => String(id) === requested) ? suppliers[0] : null;
      setParams((previous) => {
        const next = new URLSearchParams(previous);
        if (replacement) next.set('supplier', String(replacement.id));
        else next.delete('supplier');
        return next;
      }, { replace: true });
    }
  }, [loaded, requested, data, saved, removed, setParams]);
  const previousPane = useRef<{ pane: typeof pane; id: number | null }>({ pane, id: selected?.id ?? null });
  useEffect(() => {
    const previous = previousPane.current;
    previousPane.current = { pane, id: selected?.id ?? null };
    if (!pane || !previous.pane || pane === previous.pane) return;
    workspaceRef.current?.scrollIntoView?.({ block: 'start' });
    if (pane === 'detail') backRef.current?.focus();
    else workspaceRef.current?.querySelector<HTMLElement>(`[data-testid="supplier-row-${previous.id}"]`)?.focus();
  }, [pane, selected?.id]);
  const query = search.trim().toLowerCase();
  const filtered = suppliers.filter((s) =>
    [s.name, s.contact_name, s.contact_email, s.contact_phone].some((value) => value?.toLowerCase().includes(query)) &&
    (filter === 'all' || (filter === 'open' ? Number(s.open_po_count) > 0 : filter === 'moq' ? s.moq == null : s.lead_time_days == null)));
  const visible = filtered.map((supplier, index) => ({ supplier, index })).sort((a, b) =>
    (sort === 'name' ? a.supplier.name.localeCompare(b.supplier.name, undefined, { sensitivity: 'base' }) :
      sort === 'open' ? Number(b.supplier.open_po_count) - Number(a.supplier.open_po_count) : 0) || a.index - b.index).map((row) => row.supplier);
  const active = Boolean(query) || filter !== 'all';
  const hiddenSelection = selected && !visible.some((s) => s.id === selected.id);
  const clear = () => { setSearch(''); setFilter('all'); };
  const edit = () => { if (selected) { setEditingSupplier(selected); setSupplierFormOpen(true); } };
  const removeSupplierButton = selected && (<Button variant="outlined" color="error" disabled={deleting} sx={{ textTransform: 'none', color: 'var(--critical-text)', borderColor: 'var(--rule)', '&:hover': { borderColor: 'var(--critical-border)', bgcolor: 'transparent' } }} onClick={async () => {
                  const target = selected;
                  if (!window.confirm(`Remove ${target.name}? Past purchase orders are kept; the supplier is hidden from new POs.`)) return;
                  setDeleting(true); setDeleteError(null);
                  try {
                    await onDeleteSupplier(target.id);
                    setRemoved((previous) => [...previous, target.id]);
                    if (saved?.id === target.id) setSaved(null);
                  } catch (error: any) { setDeleteError(error?.response?.data?.error ?? 'Failed to remove supplier.'); }
                  finally { setDeleting(false); }
                }}>{deleting ? 'Removing…' : 'Remove supplier…'}</Button>);
  const editSupplierButton = <Button variant="contained" onClick={edit} disabled={deleting} sx={{ textTransform: 'none' }}>Edit supplier</Button>;

  return (
    <Box ref={workspaceRef} data-testid="suppliers-workspace" data-layout={narrow ? 'narrow' : 'wide'} data-pane={pane ?? undefined}
      sx={{ px: { xs: 2, md: '32px' }, pt: '20px', pb: '20px', display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0,
        '@media (min-width: 1100px)': narrow ? {} : { flex: 1, minHeight: 0 },
        [COARSE_POINTER]: { '& button, & .MuiMenuItem-root': { minHeight: 44 }, '& .MuiInputBase-root': { minHeight: 44 } } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexShrink: 0, flexWrap: 'wrap' }}>
        <Box><Typography sx={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2 }}>Suppliers</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{plural(suppliers.length, 'supplier')} · Contacts and purchasing terms.</Typography></Box>
        <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => { setEditingSupplier(null); setSupplierFormOpen(true); }}
          sx={{ bgcolor: 'var(--accent)', color: 'var(--accent-ink)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}>Add supplier</Button>
      </Box>
      {isLoading && <ModuleLoadingSkeleton />}
      {isError && <Alert severity="error">Failed to load supplier data. Please refresh.</Alert>}
      {loaded && layoutKnown && (
        suppliers.length === 0 ? <Paper variant="outlined" sx={{ textAlign: 'center', py: 6, borderRadius: 2, borderStyle: 'dashed' }}>
          <Typography variant="body2" color="text.secondary">No suppliers added yet. Add your first supplier to get started.</Typography>
        </Paper> :
        <Box sx={narrow ? { display: 'grid', gap: '12px', gridTemplateColumns: 'minmax(0, 1fr)' } : {
          display: 'grid', gap: '20px', gridTemplateColumns: 'minmax(0, 1fr)',
          '@media (min-width: 1100px)': { gridTemplateColumns: '372px minmax(0, 1fr)', flex: 1, minHeight: 0 } }}>
          <Box component="nav" aria-label="Suppliers" hidden={pane === 'detail'} sx={{ minHeight: 0, minWidth: 0, display: pane === 'detail' ? 'none' : 'flex', flexDirection: 'column', border: '1px solid var(--rule)', borderRadius: '12px', bgcolor: 'var(--surface)', overflow: 'hidden' }}>
            <Box sx={{ flexShrink: 0, p: '10px', display: 'grid', gap: '8px', borderBottom: '1px solid var(--rule)' }}>
              <Box role="search" aria-label="Filter suppliers" sx={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <TextField size="small" placeholder="Search suppliers…" inputProps={{ 'aria-label': 'Search suppliers' }} value={search} onChange={(e) => setSearch(e.target.value)}
                  sx={{ flex: 1, minWidth: 0, '& .MuiInputBase-root': { height: 32, fontSize: 13, [COARSE_POINTER]: { height: 44 } } }} />
                <Button variant="outlined" aria-label={`Supplier filters: ${SUPPLIER_FILTERS.find(([key]) => key === filter)?.[1]}`} aria-expanded={Boolean(filterAnchor)} onClick={(e) => setFilterAnchor(e.currentTarget)} sx={LIST_TOOL_SX}>Filters{filter !== 'all' ? ' · 1' : ''}</Button>
                <Button variant="outlined" aria-label={`Supplier sort: ${SUPPLIER_SORTS.find(([key]) => key === sort)?.[1]}`} aria-expanded={Boolean(sortAnchor)} onClick={(e) => setSortAnchor(e.currentTarget)} sx={LIST_TOOL_SX}>Sort</Button>
              </Box>
              <Menu anchorEl={filterAnchor} open={Boolean(filterAnchor)} onClose={() => setFilterAnchor(null)} slotProps={{ paper: { sx: COARSE_MENU_SX } }}>
                {SUPPLIER_FILTERS.map(([key, label]) => <MenuItem key={key} role="menuitemradio" aria-checked={filter === key} selected={filter === key} onClick={() => { setFilter(key); setFilterAnchor(null); }}>{label}</MenuItem>)}
                <MenuItem disabled={!active} onClick={() => { clear(); setFilterAnchor(null); }}>Clear filters</MenuItem>
              </Menu>
              <Menu anchorEl={sortAnchor} open={Boolean(sortAnchor)} onClose={() => setSortAnchor(null)} slotProps={{ paper: { sx: COARSE_MENU_SX } }}>
                {SUPPLIER_SORTS.map(([key, label]) => <MenuItem key={key} role="menuitemradio" aria-checked={sort === key} selected={sort === key} onClick={() => { setSort(key); setSortAnchor(null); }}>{label}</MenuItem>)}
              </Menu>
              <Typography variant="caption" color="text.secondary" role="status">{active ? `Showing ${visible.length} of ${suppliers.length} suppliers` : plural(suppliers.length, 'supplier')}</Typography>
              {hiddenSelection && <Button size="small" onClick={clear} sx={{ textTransform: 'none' }}>Show {selected.name}</Button>}
            </Box>
            <Box sx={{ ...THIN_SCROLL_SX, flex: 1, minHeight: 0, overflowY: 'auto', py: '4px', display: 'flex', flexDirection: 'column', gap: '1px', '@media (max-width: 1099.98px)': { maxHeight: narrow ? 'none' : 480 } }}>
              {visible.length === 0 && <Box sx={{ p: 3 }}><Typography variant="body2">No suppliers match these filters.</Typography><Button onClick={clear}>Clear filters</Button></Box>}
              {visible.map((s) => <Tooltip key={s.id} title={[s.name, s.contact_name, s.contact_email, s.contact_phone].filter(Boolean).join(' · ')} placement="right" enterDelay={400} arrow>
                <Box component="button" type="button" data-testid={`supplier-row-${s.id}`} aria-current={selected?.id === s.id ? 'true' : undefined} onClick={() => { setDeleteError(null); select(s.id); }}
                  sx={{ all: 'unset', boxSizing: 'border-box', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', columnGap: '10px', rowGap: '3px', mx: '6px', px: '14px', py: '8px', borderRadius: '8px', cursor: 'pointer',
                    bgcolor: selected?.id === s.id ? 'var(--accent-ghost)' : 'transparent', boxShadow: selected?.id === s.id ? 'inset 0 0 0 1px var(--accent-border)' : 'none',
                    '&:hover': selected?.id === s.id ? {} : { bgcolor: 'var(--bg-2)' }, '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '-2px' } }}>
                  <Box component="span" sx={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</Box>
                  <Box component="span" sx={{ fontSize: 12, color: 'var(--ink-2)' }}>{Number(s.open_po_count)} open {Number(s.open_po_count) === 1 ? 'PO' : 'POs'}</Box>
                  <Box component="span" sx={{ fontSize: 12, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.contact_name || s.contact_email || s.contact_phone || 'No contact details'}</Box>
                  <Box component="span" sx={{ fontSize: 12, color: 'var(--ink-3)' }}>{Number(s.total_pos)} received {Number(s.total_pos) === 1 ? 'PO' : 'POs'}</Box>
                </Box>
              </Tooltip>)}
            </Box>
          </Box>
          <Box hidden={pane === 'list'} sx={{ minHeight: 0, minWidth: 0, display: pane === 'list' ? 'none' : 'flex', flexDirection: 'column', gap: '8px' }}>
            {pane === 'detail' && <Button ref={backRef} startIcon={<ChevronLeft size={18} />} onClick={() => select(null)} sx={{ alignSelf: 'flex-start', minHeight: 44, color: 'var(--ink-2)', textTransform: 'none' }}>Back to suppliers</Button>}
            {selected && <Box component="section" aria-label={`Supplier details: ${selected.name}`}
              sx={{ display: 'flex', flexDirection: 'column', flex: narrow ? '0 0 auto' : 1, minHeight: 0, minWidth: 0,
                border: '1px solid var(--rule)', borderRadius: '14px', bgcolor: 'var(--surface)', overflow: 'hidden', overflowWrap: 'anywhere' }}>
              <Box component="header" sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, flexShrink: 0,
                px: narrow ? '16px' : '28px', pt: '20px', pb: '14px' }}>
                <Typography component="h2" sx={{ fontSize: 22, fontWeight: 500, lineHeight: 1.2, color: 'var(--ink)', overflowWrap: 'anywhere' }}>{selected.name}</Typography>
                {!selected.active && <Chip label="Inactive" size="small" sx={{ alignSelf: 'flex-start' }} />}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                  <RatingBadge label="On-time" value={selected.on_time_rate} />
                  <RatingBadge label="Fill" value={selected.fill_rate} />
                </Box>
              </Box>
              <Box sx={{ ...THIN_SCROLL_SX, flex: narrow ? '0 0 auto' : 1, minHeight: 0, minWidth: 0,
                overflow: narrow ? 'visible' : 'auto', px: narrow ? '16px' : '28px', pb: 2 }}>
                <Box component="section" aria-labelledby="supplier-contact-heading" sx={{ display: 'grid', gap: 1, pt: 1 }}>
                  <Typography id="supplier-contact-heading" component="h3" sx={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Contact</Typography>
                  <Typography variant="body2">Contact: {selected.contact_name || '—'}</Typography>
                  <Typography variant="body2">Email: {selected.contact_email || '—'}</Typography>
                  <Typography variant="body2">Phone: {selected.contact_phone || '—'}</Typography>
                </Box>
                <Divider sx={{ my: 2 }} />
                <Box component="section" aria-labelledby="supplier-terms-heading" sx={{ display: 'grid', gap: 1 }}>
                  <Typography id="supplier-terms-heading" component="h3" sx={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Purchasing terms</Typography>
                  <Typography variant="body2">MOQ: {selected.moq != null ? `${selected.moq} units` : '—'}</Typography>
                  {selected.moq == null && <Button onClick={edit} sx={{ justifySelf: 'start', textTransform: 'none' }}>Set minimum order →</Button>}
                  <Typography variant="body2">Lead time: {selected.lead_time_days != null ? plural(selected.lead_time_days, 'day') : '—'}</Typography>
                  {selected.lead_time_days == null && <Button onClick={edit} sx={{ justifySelf: 'start', textTransform: 'none' }}>Set delivery time →</Button>}
                </Box>
                <Divider sx={{ my: 2 }} />
                <Box component="section" aria-labelledby="supplier-performance-heading" sx={{ display: 'grid', gap: 1 }}>
                  <Typography id="supplier-performance-heading" component="h3" sx={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Supplier performance</Typography>
                  <Typography variant="body2">Open POs: {selected.open_po_count}</Typography>
                  <Typography variant="body2">Received POs: {selected.total_pos}</Typography>
                  <Typography variant="body2">Defect rate: {selected.defect_rate != null ? `${selected.defect_rate}%` : '—'}</Typography>
                </Box>
              </Box>
              <Box component="footer" sx={{ flexShrink: 0, borderTop: '1px solid var(--rule)', boxShadow: 'inset 2px 0 0 var(--accent)',
                px: narrow ? '16px' : '28px', py: '12px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 3, rowGap: 1,
                ...(narrow ? { flexDirection: 'column', alignItems: 'stretch' } : null),
                '& .MuiButton-contained': { minHeight: 44, minWidth: narrow ? 0 : 184, px: 2.5, fontSize: 14, borderRadius: '8px' },
                '& .MuiButton-contained:not(.Mui-disabled)': { bgcolor: 'var(--accent)', color: 'var(--accent-ink)', '&:hover': { bgcolor: 'var(--accent-hover)', opacity: 1 } } }}>
                {deleteError && <Alert severity="error" sx={{ flex: narrow ? '0 0 auto' : '1 1 240px', minWidth: 0 }}>{deleteError}</Alert>}
                <Box role="group" aria-label="Supplier actions" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'nowrap', gap: '10px', ml: 'auto', flex: '0 0 auto', maxWidth: '100%',
                  '& .MuiButton-root': { minHeight: 44, borderRadius: '8px', whiteSpace: 'nowrap' },
                  ...(narrow ? { flexDirection: 'column', alignItems: 'stretch', ml: 0, width: '100%', '& .MuiButton-root': { minHeight: 44, borderRadius: '8px', whiteSpace: 'normal', width: '100%' } } : null) }}>
                  {!narrow && removeSupplierButton}
                  {editSupplierButton}
                  {narrow && removeSupplierButton}
                </Box>
              </Box>
            </Box>}
          </Box>
        </Box>
      )}
      <Box sx={{ [COARSE_POINTER]: { '& .MuiButton-root': { minHeight: 44 } } }}>
        <SupplierFormDialog open={supplierFormOpen} mode={editingSupplier ? 'edit' : 'add'} initial={editingSupplier ?? undefined}
          onClose={() => { setSupplierFormOpen(false); setEditingSupplier(null); }}
          onSubmit={async (input) => {
            const result = editingSupplier ? await onUpdateSupplier(editingSupplier.id, input) : await onCreateSupplier(input);
            setSaved(result);
            select(result.id);
          }} />
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────
// ASSIGN SUPPLIER DIALOG (§7.6 ISS-SR-03)
// ─────────────────────────────────────────────
type AssignSupplierTarget = {
  lasyncro_variant_id: string;
  title: string;
  sku: string | null;
  product_id: string | null;
  product_type: string | null;
};

function AssignSupplierDialog({
  open, target, suppliers, onClose, onSubmit,
}: {
  open: boolean;
  target: AssignSupplierTarget | null;
  suppliers: Supplier[];
  onClose: () => void;
  onSubmit: (input: { supplier_id: number; scope_type: string; scope_id: string; priority: number; note?: string }) => Promise<void>;
}) {
  const [supplierId, setSupplierId] = useState<string>('');
  const [scopeType, setScopeType] = useState<'variant' | 'product' | 'product_type'>('variant');
  const [priority, setPriority] = useState<1 | 2>(1);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setSupplierId(''); setScopeType('variant'); setPriority(1); setNote(''); setError(null); }
  }, [open]);

  const scopeId =
    scopeType === 'variant' ? (target?.lasyncro_variant_id ?? '') :
    scopeType === 'product' ? (target?.product_id ?? '') :
    (target?.product_type ?? '');

  const scopeOptions: { value: 'variant' | 'product' | 'product_type'; label: string }[] = [
    { value: 'variant', label: 'Apply to this variant only' },
    ...(target?.product_id ? [{ value: 'product' as const, label: 'Apply to all variants of this product' }] : []),
    ...(target?.product_type ? [{ value: 'product_type' as const, label: `Apply to all "${target.product_type}" products` }] : []),
  ];

  const handleSubmit = async () => {
    if (!supplierId) return setError('Please select a supplier.');
    if (!scopeId) return setError('Scope ID could not be resolved. Try "this variant only".');
    setSubmitting(true);
    try {
      await onSubmit({ supplier_id: Number(supplierId), scope_type: scopeType, scope_id: scopeId, priority, note: note.trim() || undefined });
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Failed to assign supplier.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Assign supplier
        {target && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
            {target.title}{target.sku ? ` · ${target.sku}` : ''}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1.5 }}>
        {error && <Alert severity="error">{error}</Alert>}

        <TextField select label="Supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} fullWidth size="small">
          {suppliers.filter((s) => s.active).map((s) => (
            <MenuItem key={s.id} value={String(s.id)}>{s.name}</MenuItem>
          ))}
        </TextField>

        <Box>
          <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>APPLY TO</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {scopeOptions.map((opt) => (
              <Box key={opt.value} onClick={() => setScopeType(opt.value)}
                sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 1, borderRadius: 1.5, border: '1px solid', borderColor: scopeType === opt.value ? 'var(--accent)' : 'divider', cursor: 'pointer', bgcolor: scopeType === opt.value ? 'var(--accent-ghost)' : 'transparent', transition: 'all 0.15s' }}>
                <Box sx={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid', borderColor: scopeType === opt.value ? 'var(--accent)' : 'action.disabled', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {scopeType === opt.value && <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'var(--accent)' }} />}
                </Box>
                <Typography variant="body2">{opt.label}</Typography>
              </Box>
            ))}
          </Box>
        </Box>

        <Box>
          <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>PRIORITY</Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            {([{ v: 1, label: 'Primary' }, { v: 2, label: 'Backup' }] as { v: 1 | 2; label: string }[]).map(({ v, label }) => (
              <Box key={v} onClick={() => setPriority(v)}
                sx={{ flex: 1, textAlign: 'center', px: 1.5, py: 1, borderRadius: 1.5, border: '1px solid', borderColor: priority === v ? 'var(--accent)' : 'divider', cursor: 'pointer', bgcolor: priority === v ? 'var(--accent-ghost)' : 'transparent', transition: 'all 0.15s' }}>
                <Typography variant="body2" fontWeight={priority === v ? 600 : 400}>{label}</Typography>
              </Box>
            ))}
          </Box>
        </Box>

        <TextField label="Note (optional)" size="small" fullWidth multiline rows={2}
          value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Why this supplier for this product..." />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting} color="inherit">Cancel</Button>
        <Button variant="contained" onClick={() => void handleSubmit()} disabled={submitting || !supplierId}
          sx={{ bgcolor: 'var(--accent)', color: 'var(--accent-ink)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}>
          {submitting ? 'Saving...' : 'Assign supplier'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

/**
 * SRC-01b — PO readiness gates in the accumulator UI
 *
 * `gates` and `po_ready` come from the server (SRC-01a) and are never
 * recomputed here — the UI reflects backend truth so the two cannot drift.
 *   HARD (lead_time_set, all_lines_have_sku) → button disabled + named reason
 *   SOFT (moq_met)                           → enabled, routed via confirm
 * Convert re-checks every gate server-side; this is affordance, not security.
 * Gate rejections render inline per supplier group (convertErrors) rather than
 * being swallowed by the old catch-free handler.
 */
function PurchasingSourcingView({
  data,
  onCreatePo,
  onSearchVariants,
  onFetchSourcingRecommendations,
  onFetchSourcingWorklist,
  onFetchPreferences,
  onCreatePreference,
  onDeletePreference,
  onFetchReorderRequests,
  onCreateReorderRequest,
  onDeleteReorderRequest,
  onConvertReorderRequests,
  lastConvertedPoId,
  onDismissConvertedPo,
  spotlights,
}: SuppliersPortalPageProps) {
  const neverOrdered = data?.never_ordered ?? [];
  const neverOrderedCount = data?.never_ordered_count ?? 0;
  const suppliers = data?.suppliers ?? [];

  const [searchParams] = useSearchParams();
  const sourcingNavigate = useNavigate();
  const triggerVariantId = searchParams.get('variantId');
  /**
   * OUTCOME-INV-01: the inventory treatment the merchant was looking at in
   * Order Detail when they followed the CTA. ADVISORY PROVENANCE ONLY — the
   * server never uses it for authorization, constraint lookup, ranking or
   * outcome, and normalizes anything it does not recognise to null.
   */
  const triggerTreatmentKey = searchParams.get('treatmentKey');
  // §8: needed qty from alert deep-link — used for "Add to queue" pre-fill
  // SRC-03: was Number(searchParams.get('needed') ?? 1) || 1 — but nothing in
  // the codebase ever set `?needed=`, so every queued request was 1 unit and
  // the MOQ accumulator could never fill. Now derived server-side, prefilled
  // into an editable field so the operator can override with what they know.
  const [shortfall, setShortfall] = useState<number>(0);
  const [shortfallBasis, setShortfallBasis] = useState<{ demand: number; available: number } | null>(null);
  const [queueQty, setQueueQty] = useState<number>(0);
  // SRC-12: which number the operator is looking at, so a fallback is never
  // mistaken for a forecast.
  const [quantityBasis, setQuantityBasis] = useState<SourcingResult['quantity_basis']>('reactive');
  const [prefillQty, setPrefillQty] = useState<number>(0);
  const [planningContext, setPlanningContext] = useState<SourcingResult['planning_context']>(null);

  const [activeVariantId, setActiveVariantId] = useState<string | null>(triggerVariantId);
  /**
   * SOURCING-UX-COGNITIVE-01 Slice 2 correction: activeVariantId previously
   * only ever took its INITIAL value from triggerVariantId (useState's
   * initializer runs once). The Unified Sourcing Worklist's Review action
   * navigates within this same component instance
   * (?variantId=<canonical>), which changes triggerVariantId on the next
   * render but never re-synced activeVariantId — so Level 1 -> Level 2
   * silently did nothing. Kept as a separate state (not derived directly
   * from triggerVariantId) because nothing else in this component may ever
   * need to diverge from the URL, but the effect keeps it authoritative.
   */
  useEffect(() => {
    setActiveVariantId(triggerVariantId);
  }, [triggerVariantId]);
  const [recommendations, setRecommendations] = useState<SourcingRecommendation[]>([]);
  const [isLoadingRecs, setIsLoadingRecs] = useState(false);

  /** Slice 1A: the targeted payload for activeVariantId, or null. */
  const [targeted, setTargeted] = useState<SourcingResult | null>(null);
  /**
   * Three targeted outcomes that must never render together:
   *
   *   'ok'        → a real result (which may legitimately have no suppliers)
   *   'not_found' → 404; the deep link points at a variant this tenant
   *                 does not own
   *   'error'     → 5xx/network; we do not know, and must not guess
   *
   * Held as one value rather than parallel booleans precisely because they are
   * mutually exclusive: a 404 previously set nothing while ALSO clearing
   * recommendations, which satisfied the legacy "no supplier history" gate and
   * told the merchant something false about their own catalogue.
   */
  const [targetFetchState, setTargetFetchState] =
    useState<'ok' | 'not_found' | 'error'>('ok');
  /**
   * SRC-ACT-UI-05: bumping this re-reads the SAME target without touching the
   * URL, so assigning a supplier does not cost the merchant their place —
   * variantId and orderId both survive.
   */
  const [targetRefreshKey, setTargetRefreshKey] = useState(0);
  /**
   * "Review queue →" continues on THIS surface. The pending reorders area is
   * already here; sending the merchant to a new route to look at something
   * three sections down would be navigation for its own sake.
   */
  const pendingReordersRef = useRef<HTMLDivElement>(null);

  const [preferences, setPreferences] = useState<PreferenceRow[]>([]);
  const [isLoadingPrefs, setIsLoadingPrefs] = useState(false);

  // §8 reorder accumulator state
  const [reorderRequests, setReorderRequests] = useState<SupplierAccumulation[]>([]);
  const [convertingSupplierIds, setConvertingSupplierIds] = useState<Set<number>>(new Set());
  // SRC-01b: gate failures must be visible, never a silent no-op click.
  const [convertErrors, setConvertErrors] = useState<Record<number, string>>({});
  // SRC-01b: under-MOQ is a soft gate — one confirm, then an explicit override.
  const [moqConfirmGroup, setMoqConfirmGroup] = useState<SupplierAccumulation | null>(null);

  const [createPoOpen, setCreatePoOpen] = useState(false);
  const [poVariantId, setPoVariantId] = useState<string | undefined>(undefined);
  const [poSupplierId, setPoSupplierId] = useState<number | undefined>(undefined);

  const [assignTarget, setAssignTarget] = useState<AssignSupplierTarget | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  // §8: per-supplier queue button state — 'idle' | 'adding' | 'added'
  const [queueButtonState, setQueueButtonState] = useState<Record<number, 'idle' | 'adding' | 'added'>>({});

  /**
   * SOURCING-UX-COGNITIVE-01 Slice 2 — UNIFIED SOURCING WORKLIST state.
   * Generic (no-variantId) mode only. Declared unconditionally (Rules of
   * Hooks) even though only read/used when !activeVariantId below.
   */
  const [worklist, setWorklist] = useState<SourcingWorklistResult | null>(null);
  const [isLoadingWorklist, setIsLoadingWorklist] = useState(false);
  const [worklistQuery, setWorklistQuery] = useState('');
  const [worklistCategory, setWorklistCategory] = useState<SourcingWorklistCategory | undefined>(undefined);
  const [worklistSupplierReadiness, setWorklistSupplierReadiness] =
    useState<SourcingWorklistParams['supplier_readiness']>(undefined);
  const [worklistPurchasingStage, setWorklistPurchasingStage] =
    useState<SourcingWorklistParams['purchasing_stage']>(undefined);
  const [worklistCoverage, setWorklistCoverage] = useState<SourcingWorklistParams['coverage']>(undefined);
  const [worklistSort, setWorklistSort] = useState<SourcingWorklistParams['sort']>('action_priority');
  const [worklistPage, setWorklistPage] = useState(1);
  const [worklistPageSize, setWorklistPageSize] = useState(50);
  /** Supplier settings is a secondary access point, collapsed by default. */
  const [supplierSettingsOpen, setSupplierSettingsOpen] = useState(false);
  /**
   * SOURCING-UX-COGNITIVE-01 Slice 2B — bumped after a successful Level-1
   * supplier assignment so the worklist is RE-FETCHED from the server rather
   * than having its category locally mutated. The row's new category
   * (needs_purchase / plan_ahead / excluded) is server-derived truth — see
   * handleAssignSave below.
   */
  const [worklistRefreshKey, setWorklistRefreshKey] = useState(0);

  useEffect(() => {
    if (activeVariantId) return;
    setIsLoadingWorklist(true);
    onFetchSourcingWorklist({
      q: worklistQuery || undefined,
      category: worklistCategory,
      supplier_readiness: worklistSupplierReadiness,
      purchasing_stage: worklistPurchasingStage,
      coverage: worklistCoverage,
      sort: worklistSort,
      page: worklistPage,
      page_size: worklistPageSize,
    })
      .then(setWorklist)
      .finally(() => setIsLoadingWorklist(false));
  }, [
    activeVariantId,
    onFetchSourcingWorklist,
    worklistQuery,
    worklistCategory,
    worklistSupplierReadiness,
    worklistPurchasingStage,
    worklistCoverage,
    worklistSort,
    worklistPage,
    worklistPageSize,
    worklistRefreshKey,
  ]);

  // §7.6: fetch preferences for default/no-variantId state
  useEffect(() => {
    setIsLoadingPrefs(true);
    onFetchPreferences().then(setPreferences).finally(() => setIsLoadingPrefs(false));
  }, [onFetchPreferences]);

  // §8: fetch pending reorder requests on mount
  useEffect(() => {
    onFetchReorderRequests().then(setReorderRequests);
  }, [onFetchReorderRequests]);

  // §8: add variant+supplier to accumulator — uses alert qty when available
  const handleAddToQueue = async (variantId: string, supplierId: number) => {
    setQueueButtonState((prev) => ({ ...prev, [supplierId]: 'adding' }));
    try {
      /**
       * OUTCOME-INV-01 — the SERVER-VALIDATED originating order, not the raw
       * URL value. sourcing-recommendations checks `?orderId=` against this
       * variant's canonical blocking orders and echoes back
       * `originating_order_id`, returning null when the order does not belong.
       * Deferring to that answer means a deep link cannot assert an
       * attribution the server would refuse.
       */
      const originatingOrderId = targeted?.originating_order_id ?? null;

      await onCreateReorderRequest({
        lasyncro_variant_id: variantId,
        supplier_id: supplierId,
        qty_requested: queueQty,
        source: triggerVariantId ? 'alert' : 'manual',
        ...(originatingOrderId ? { originating_order_id: originatingOrderId } : {}),
        ...(originatingOrderId && triggerTreatmentKey
          ? { shown_treatment_key: triggerTreatmentKey }
          : {}),
      });
      const updated = await onFetchReorderRequests();
      setReorderRequests(updated);
      // Flash "Added ✓" for 1.5s so merchant knows the click registered
      setQueueButtonState((prev) => ({ ...prev, [supplierId]: 'added' }));
      setTimeout(() => setQueueButtonState((prev) => ({ ...prev, [supplierId]: 'idle' })), 1500);
    } catch {
      setQueueButtonState((prev) => ({ ...prev, [supplierId]: 'idle' }));
    }
  };

  // §8: convert all pending for a supplier → draft PO, then clear from accumulator
  const handleConvert = async (supplierId: number, overrideMoq = false) => {
    setConvertingSupplierIds((prev) => new Set(prev).add(supplierId));
    setConvertErrors((prev) => { const e = { ...prev }; delete e[supplierId]; return e; });
    try {
      // onConvertReorderRequests sets lastConvertedPoId at page level
      // before refetch so banner survives the re-render
      await onConvertReorderRequests(supplierId, overrideMoq);
      const updated = await onFetchReorderRequests();
      setReorderRequests(updated);
    } catch (err) {
      // SRC-01b: surface the server's gate reason inline on the group row.
      const message = err instanceof Error ? err.message : 'Failed to create purchase order';
      setConvertErrors((prev) => ({ ...prev, [supplierId]: message }));
    } finally {
      setConvertingSupplierIds((prev) => { const s = new Set(prev); s.delete(supplierId); return s; });
    }
  };

  // SRC-01b: hard gates block the click entirely; the soft MOQ gate routes
  // through a confirm dialog so the override is a deliberate act.
  const handleConvertClick = (group: SupplierAccumulation) => {
    if (!group.gates.moq_met) {
      setMoqConfirmGroup(group);
      return;
    }
    void handleConvert(group.supplier_id);
  };

  useEffect(() => {
    if (!activeVariantId) return;
    setIsLoadingRecs(true);
    setTargetFetchState('ok');
    onFetchSourcingRecommendations(activeVariantId)
      .then((result) => {
        setTargetFetchState('ok');
        setTargeted(result);
        setRecommendations(result.recommendations);
        setShortfall(result.shortfall);
        setShortfallBasis(result.shortfall_basis);
        // SRC-12: prefill from the trusted quantity, not the reactive
        // shortfall. The old Math.max(1, ...) floor queued 1 unit against a
        // zero requirement, fabricating MOQ contribution from nothing.
        // Deliberate over-ordering stays possible — it just stops being
        // automatic.
        setQuantityBasis(result.quantity_basis);
        setPlanningContext(result.planning_context);
        /**
         * SRC-ACT-UI-07/10: in targeted recovery the quantity that still needs
         * a purchasing decision is `unplanned` — what remains after the units
         * already queued or drafted. Prefilling the full requirement would ask
         * the merchant to buy the same units twice. Falls back to the Slice 1A
         * queue quantity when the server has not supplied the workflow facts.
         * The field stays editable, and BOTH purchasing actions read the
         * edited value, so a deliberate override is never silently discarded.
         */
        const targetedQty = result.unplanned ?? result.queue_qty;
        setPrefillQty(targetedQty);
        setQueueQty(targetedQty);
      })
      .catch((err: unknown) => {
        // Only a 404 means "this target does not exist". Any other failure is
        // unknown territory: claiming "no supplier history" would tell the
        // merchant something false about their own catalogue.
        const status =
          (err as { status?: number; response?: { status?: number } })?.status
          ?? (err as { response?: { status?: number } })?.response?.status;
        setTargeted(null);
        setRecommendations([]);
        setTargetFetchState(status === 404 ? 'not_found' : 'error');
      })
      .finally(() => setIsLoadingRecs(false));
  }, [activeVariantId, onFetchSourcingRecommendations, targetRefreshKey]);

  const handleCreatePoFromRec = (variantId: string, supplierId: number) => {
    setPoVariantId(variantId);
    setPoSupplierId(supplierId);
    setCreatePoOpen(true);
  };

  const handleAssignOpen = (v: typeof neverOrdered[0]) => {
    setAssignTarget({ lasyncro_variant_id: v.lasyncro_variant_id, title: v.title, sku: v.sku, product_id: v.product_id, product_type: v.product_type });
    setAssignOpen(true);
  };

  /**
   * SRC-ACT-UI-04A/05: assigning from targeted recovery. The target is built
   * from the canonical identity already on screen — `product_id` and
   * `product_type` are genuinely unknown here, and variant scope is the
   * default anyway, so their absence must not block the assignment.
   */
  const handleTargetedAssignOpen = () => {
    if (!activeVariantId) return;
    setAssignTarget({
      lasyncro_variant_id: activeVariantId,
      title: targeted?.variant_title ?? targeted?.product_title ?? 'this variant',
      sku: targeted?.sku ?? null,
      product_id: null,
      product_type: null,
    });
    setAssignOpen(true);
  };

  /**
   * SOURCING-UX-COGNITIVE-01 Slice 2B — assigning directly from a Level 1
   * needs_supplier worklist row. Reuses the SAME AssignSupplierDialog and
   * handleAssignSave/onCreatePreference path as targeted mode above;
   * product_id/product_type are unknown at Level 1 (not part of the
   * worklist response) so, exactly like handleTargetedAssignOpen, the
   * dialog degrades to "this variant only" scope — no new backend field.
   */
  const handleWorklistAssignOpen = (item: SourcingWorklistItem) => {
    setAssignTarget({
      lasyncro_variant_id: item.lasyncro_variant_id,
      title: item.variant_title ?? item.product_title ?? 'this variant',
      sku: item.sku,
      product_id: null,
      product_type: null,
    });
    setAssignOpen(true);
  };

  const handleAssignSave = async (input: { supplier_id: number; scope_type: string; scope_id: string; priority: number; note?: string }) => {
    await onCreatePreference(input);
    const updated = await onFetchPreferences();
    setPreferences(updated);
    // SRC-ACT-UI-05: the assignment changes what this variant's recommendations
    // ARE, so re-read the target. Refreshing the preference list alone would
    // leave the merchant looking at the "no usable supplier" state they just
    // resolved.
    if (activeVariantId) setTargetRefreshKey((n) => n + 1);
    // SOURCING-UX-COGNITIVE-01 Slice 2B: assigning from a Level 1 worklist row
    // (activeVariantId is null there) changes that row's server-derived
    // category (needs_supplier -> needs_purchase/plan_ahead, or out of the
    // current filter entirely) — refetch the worklist rather than guessing.
    if (!activeVariantId) setWorklistRefreshKey((n) => n + 1);
  };

  const handleDeletePreference = async (id: string) => {
    await onDeletePreference(id);
    setPreferences((prev) => prev.filter((p) => p.id !== id));
  };

  // SRC-06: one list. Splitting on MOQ pushed suppliers with a minimum into a
  // dimmed group whose only action was "Create PO anyway" — steering the
  // merchant toward an under-minimum order instead of toward pooling, which
  // is what the accumulator exists for. The gap is shown per row instead.
  const goodMatches = recommendations;

  /**
   * SRC-ACT-UI-01…08 — TARGETED ACTION RESOLVER
   * -------------------------------------------
   * The old surface offered "Add to queue" and "Create PO" on every supplier
   * row, in every state, including states where starting a new purchase is
   * exactly wrong: fully covered by inbound, or already queued, or already
   * drafted. Two equally-weighted buttons per row is not a decision aid.
   *
   * One target, one dominant next action. Precedence is deliberate and reads
   * top to bottom: nothing to buy → already bought → already being bought →
   * cannot buy → how to buy.
   *
   * This resolver governs TARGETED mode only. Generic Sourcing keeps its
   * existing row actions untouched.
   */
  const targetedAction = (() => {
    if (!activeVariantId || targetFetchState !== 'ok' || !targeted) return null;

    const stillToSource   = targeted.still_to_source ?? 0;
    const committedInbound = targeted.committed_inbound ?? 0;
    const unplanned       = targeted.unplanned ?? stillToSource;
    const queuedQty       = targeted.pending_queue_qty ?? 0;
    const draftQty        = targeted.draft_po_qty ?? 0;
    const topRec          = goodMatches[0] ?? null;

    // 1. Nothing left to buy, and stock is already on the way. Offering a new
    //    purchase here asks the merchant to pay twice for the same units.
    if (stillToSource === 0 && committedInbound > 0) {
      return {
        kind: 'inbound' as const,
        primary: { label: 'View inbound →', onClick: () => sourcingNavigate('/suppliers-portal') },
        secondary: null,
        // Inbound is not fulfillment capacity. The order stays blocked until
        // the stock is actually pickable — arrival alone clears nothing.
        note: `${committedInbound} units already on the way. This order stays blocked until enough stock becomes pickable.`,
      };
    }

    // 2. Already being bought. A draft is further along than a queue entry, so
    //    when both cover the need the draft is the one to continue.
    if (stillToSource > 0 && unplanned === 0 && draftQty > 0) {
      return {
        kind: 'draft' as const,
        primary: { label: 'Review draft PO →', onClick: () => sourcingNavigate('/suppliers-portal') },
        secondary: null,
        note: `${draftQty} units are already on a draft purchase order. Nothing is on the way until it is sent.`,
      };
    }

    if (stillToSource > 0 && unplanned === 0 && queuedQty > 0) {
      return {
        kind: 'queue' as const,
        primary: {
          label: 'Review queue →',
          onClick: () => pendingReordersRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        },
        secondary: null,
        note: `${queuedQty} units are already queued for reorder.`,
      };
    }

    // 3. There is work to do but nobody to buy from. Note this is about a
    //    USABLE recommendation, not about a saved preference: demanding an
    //    assignment from a merchant who already has a supplier they have
    //    bought from would block purchasing on bookkeeping.
    if (!topRec) {
      return {
        kind: 'needs_supplier' as const,
        primary: { label: 'Assign supplier', onClick: handleTargetedAssignOpen },
        secondary: null,
        note: 'No supplier is set up for this product yet.',
      };
    }

    // 4. Buying is possible. MOQ decides which path leads: below a minimum,
    //    pooling is the cheaper move and ordering early is the deliberate
    //    exception — not the other way round.
    const belowMoq = topRec.moq != null && topRec.units_to_moq > 0;

    if (belowMoq) {
      return {
        kind: 'below_moq' as const,
        primary: {
          label: 'Add to queue →',
          onClick: () => void handleAddToQueue(activeVariantId, topRec.id),
        },
        secondary: {
          label: 'Order now instead',
          onClick: () => handleCreatePoFromRec(activeVariantId, topRec.id),
        },
        note: `${topRec.units_to_moq} more units reach ${topRec.name}'s ${topRec.moq} minimum.`,
      };
    }

    return {
      kind: 'ready' as const,
      primary: {
        label: 'Prepare PO →',
        onClick: () => handleCreatePoFromRec(activeVariantId, topRec.id),
      },
      secondary: {
        label: 'Add to queue →',
        onClick: () => void handleAddToQueue(activeVariantId, topRec.id),
      },
      note: `${topRec.name} · a draft purchase order. Nothing is ordered until you send it.`,
    };
  })();

  /** True only in targeted mode, where the resolver owns purchasing actions. */
  const isTargetedMode = Boolean(activeVariantId && targetFetchState === 'ok' && targeted);

  /**
   * SRC-ACT-UI-12/13: only these two states start NEW purchasing work. The
   * continuation states — inbound, draft, queue — and the no-supplier state
   * have no quantity to spend, so they render no quantity control.
   */
  const isNewPurchaseAction =
    targetedAction?.kind === 'below_moq' || targetedAction?.kind === 'ready';

  /**
   * SRC-ACT-UI-07 — what Prepare PO actually hands the dialog.
   *
   * This used to be an empty description and a hardcoded quantity of 1, and
   * CreatePoDialog only seeded a line when the description was truthy — so a
   * targeted hand-off seeded nothing at all: a blank line, and a single unit
   * against a real requirement. Send the identity already on screen, the
   * canonical variant, and the quantity the merchant is looking at.
   */
  const targetedPoLineItem = poVariantId
    ? {
        description:
          [targeted?.product_title, targeted?.variant_title, targeted?.sku]
            .filter(Boolean)
            .join(' · ') || 'Targeted sourcing line',
        quantity_ordered: queueQty,
        lasyncro_variant_id: poVariantId,
      }
    : undefined;

  const prefsByScope = {
    variant:      preferences.filter(p => p.scope_type === 'variant'),
    product:      preferences.filter(p => p.scope_type === 'product'),
    product_type: preferences.filter(p => p.scope_type === 'product_type'),
  };
  const scopeLabels: Record<string, string> = { variant: 'Variant', product: 'Product', product_type: 'Product Type' };

  /**
   * SOURCING-UX-COGNITIVE-01 Slice 2 — UNIFIED SOURCING WORKLIST.
   * Generic (no-variantId) mode renders this instead of the Level-2 targeted
   * decision card below. Targeted mode (activeVariantId truthy) is entirely
   * unchanged — everything from here down in the function's remaining
   * `return` is the same Slice 1A/1B JSX it always was.
   */
  if (!activeVariantId) {
    const worklistCategoryCounts: Array<{ key: SourcingWorklistCategory; label: string }> = [
      { key: 'needs_supplier', label: 'Needs supplier' },
      { key: 'needs_purchase', label: 'Needs purchase' },
      { key: 'in_purchasing',  label: 'In purchasing' },
      { key: 'covered_inbound', label: 'Covered inbound' },
      { key: 'plan_ahead',     label: 'Plan ahead' },
    ];

    // modules-ux-playbook.md §2 — Tier 1 (commits/resolves) and Tier 2
    // (navigates to a related surface) CTA treatments, applied via MUI
    // Button `sx` per §7 ("Adding a new CTA").
    const tier1Sx = {
      bgcolor: 'var(--accent)',
      color: 'var(--accent-ink)',
      fontWeight: 600,
      fontSize: 11,
      textTransform: 'none' as const,
      borderRadius: '6px',
      boxShadow: 'none',
      '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88, boxShadow: 'none' },
    };
    const tier2Sx = {
      color: 'var(--accent-text)',
      border: '0.5px solid var(--accent)',
      bgcolor: 'transparent',
      fontWeight: 500,
      fontSize: 11,
      textTransform: 'none' as const,
      borderRadius: '6px',
      boxShadow: 'none',
      '&:hover': { bgcolor: 'transparent', opacity: 0.75, boxShadow: 'none' },
    };
    const selectStyle: React.CSSProperties = {
      padding: '6px 10px',
      fontSize: 12,
      fontFamily: 'inherit',
      border: '1px solid var(--rule)',
      borderRadius: '8px',
      background: 'var(--surface)',
      color: 'var(--ink)',
    };

    const goToLevel2 = (variantId: string) =>
      sourcingNavigate(`/suppliers-portal/sourcing?variantId=${encodeURIComponent(variantId)}`);
    // Existing Level-2 targetedAction destination for draft/queue/inbound
    // review — no new purchasing route is invented here (SRC-WL-2B-10/11).
    const goToPurchasingHub = () => sourcingNavigate('/suppliers-portal');

    /**
     * SOURCING-UX-COGNITIVE-01 Slice 2B row-action model (SRC-WL-2B-06/09/10/11/13).
     * needs_supplier is the one category with two actions — Assign supplier
     * (primary, resolves the row) plus Review (secondary, Level 2). Every
     * other category keeps exactly one action. Prepare PO is deliberately
     * absent everywhere here — it needs ranked supplier data the worklist
     * must not fetch (SRC-WL-UI-14) and stays Level-2-only.
     */
    const rowActions = (item: SourcingWorklistItem) => {
      switch (item.category) {
        case 'needs_supplier':
          return (
            <>
              <Button size="small" variant="contained" sx={tier1Sx} onClick={() => handleWorklistAssignOpen(item)}>
                Assign supplier
              </Button>
              <Button size="small" variant="outlined" sx={tier2Sx} onClick={() => goToLevel2(item.lasyncro_variant_id)}>
                Review
              </Button>
            </>
          );
        case 'in_purchasing':
          // Draft wins over queue — matches Level 2's targetedAction resolver
          // ("a draft is further along than a queue entry").
          if (item.draft_po_qty > 0) {
            return (
              <Button size="small" variant="outlined" sx={tier2Sx} onClick={goToPurchasingHub}>
                Review draft PO
              </Button>
            );
          }
          if (item.pending_queue_qty > 0) {
            return (
              <Button size="small" variant="outlined" sx={tier2Sx} onClick={goToPurchasingHub}>
                Review queue
              </Button>
            );
          }
          return (
            <Button size="small" variant="outlined" sx={tier2Sx} onClick={() => goToLevel2(item.lasyncro_variant_id)}>
              Review
            </Button>
          );
        case 'covered_inbound':
          return (
            <Button size="small" variant="outlined" sx={tier2Sx} onClick={goToPurchasingHub}>
              View inbound
            </Button>
          );
        case 'needs_purchase':
        case 'plan_ahead':
        default:
          return (
            <Button size="small" variant="outlined" sx={tier2Sx} onClick={() => goToLevel2(item.lasyncro_variant_id)}>
              Review
            </Button>
          );
      }
    };

    /**
     * SRC-WL-2B-12: needs_supplier reason copy branches on WHICH precedence
     * branch produced the category (see sourcing-recommendation-playbook.md
     * §13.19/§13.20). unplanned>0 -> reactive; unplanned===0 -> reached only
     * via the planning branch (still_to_source and in_purchasing are both
     * necessarily 0 there), so "0 still to source" is never shown.
     */
    const reasonFor = (item: SourcingWorklistItem): string => {
      switch (item.category) {
        case 'needs_supplier':
          if (item.unplanned > 0) {
            return `${item.still_to_source} still to source · no supplier assigned`;
          }
          return item.days_of_stock_remaining != null
            ? `Stockout projected in ${item.days_of_stock_remaining} days · no supplier assigned`
            : 'Replenishment due · no supplier assigned';
        case 'needs_purchase':
          return `${item.still_to_source} still to source · ${item.blocked_order_count} orders waiting`;
        case 'in_purchasing':
          return `${item.in_purchasing} in purchasing · ${item.still_to_source} still to source`;
        case 'covered_inbound':
          return `${item.committed_inbound} inbound · customer shortage covered`;
        case 'plan_ahead':
          return item.days_of_stock_remaining != null
            ? `Stockout projected in ${item.days_of_stock_remaining} days`
            : 'Stockout projected soon';
        default:
          return '';
      }
    };

    /**
     * SRC-WL-UI-03 defensive invariant: when no explicit category filter is
     * selected, covered_inbound rows must never render in the default
     * immediate-action view — even if the server response includes one.
     * Selecting category=covered_inbound explicitly still renders them.
     * Summary counts are untouched (derived straight from worklist.summary).
     */
    const items = (worklist?.items ?? []).filter(
      (item) => worklistCategory === 'covered_inbound' || item.category !== 'covered_inbound'
    );
    const summary = worklist?.summary ?? {
      needs_supplier: 0, needs_purchase: 0, in_purchasing: 0, covered_inbound: 0, plan_ahead: 0,
    };

    const totalItems = worklist?.total ?? 0;
    const effectivePageSize = worklist?.page_size ?? worklistPageSize;
    const currentPage = worklist?.page ?? worklistPage;
    const totalPages = Math.max(1, Math.ceil(totalItems / Math.max(1, effectivePageSize)));
    const rangeStart = totalItems === 0 ? 0 : (currentPage - 1) * effectivePageSize + 1;
    const rangeEnd = Math.min(currentPage * effectivePageSize, totalItems);

    return (
      <Box data-testid="sourcing-worklist" sx={{ p: 2 }}>
        {/* 1. Title + secondary Supplier settings */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography sx={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>Sourcing</Typography>
          <Button
            data-testid="supplier-settings-entry"
            size="small"
            variant="outlined"
            sx={tier2Sx}
            onClick={() => setSupplierSettingsOpen((v) => !v)}
          >
            Supplier settings
          </Button>
        </Box>

        {/* Supplier settings — secondary access; preferences no longer dominate generic Sourcing. */}
        {supplierSettingsOpen && (
          <Box
            data-testid="supplier-preferences-panel"
            sx={{ mb: 2, p: 1.5, border: '1px solid var(--rule)', borderRadius: '10px' }}
          >
            <Typography sx={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)' }}>Supplier preferences</Typography>
            {preferences.length === 0 && (
              <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', mt: 0.5 }}>None set</Typography>
            )}
            {preferences.map((pref) => (
              <Box key={pref.id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 0.5 }}>
                <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {scopeLabels[pref.scope_type]} · {pref.supplier_name}
                </Typography>
                <IconButton size="small" onClick={() => void onDeletePreference(pref.id)}>
                  <Trash2 size={14} />
                </IconButton>
              </Box>
            ))}
          </Box>
        )}

        {/* 2. Category/count controls — precede search/filter controls (SRC-WL-2B-03). */}
        <Box data-testid="sourcing-worklist-category-counts" sx={{ display: 'flex', gap: 0.75, mb: 1.5, flexWrap: 'wrap' }}>
          {worklistCategoryCounts.map(({ key, label }) => {
            const active = worklistCategory === key;
            return (
              <Box
                key={key}
                component="button"
                type="button"
                data-testid={`sourcing-worklist-category-${key}`}
                onClick={() => { setWorklistPage(1); setWorklistCategory(key); }}
                sx={{
                  display: 'inline-flex', alignItems: 'center', gap: 0.5,
                  px: 1.25, py: 0.5, fontSize: 10.5, fontWeight: 600, fontFamily: 'inherit',
                  border: '1px solid', borderRadius: '999px', cursor: 'pointer',
                  borderColor: active ? 'var(--accent)' : 'var(--rule)',
                  bgcolor: active ? 'var(--accent-ghost)' : 'var(--surface)',
                  color: active ? 'var(--accent)' : 'var(--ink)',
                }}
              >
                {label} · {summary[key]}
              </Box>
            );
          })}
          {worklistCategory && (
            <Box
              component="button"
              type="button"
              onClick={() => { setWorklistPage(1); setWorklistCategory(undefined); }}
              sx={{
                px: 1.25, py: 0.5, fontSize: 10.5, fontWeight: 500, fontFamily: 'inherit',
                border: '0.5px solid var(--rule)', borderRadius: '999px', cursor: 'pointer',
                bgcolor: 'transparent', color: 'var(--ink-3)',
              }}
            >
              Clear
            </Box>
          )}
        </Box>

        {/* 3. Search */}
        <Box sx={{ mb: 1.5 }}>
          <TextField
            size="small"
            placeholder="Search product, variant, or SKU"
            value={worklistQuery}
            onChange={(e) => { setWorklistPage(1); setWorklistQuery(e.target.value); }}
            sx={{
              minWidth: 240,
              '& .MuiOutlinedInput-root': {
                bgcolor: 'var(--surface)',
                fontSize: 12,
                '& fieldset': { borderColor: 'var(--rule)' },
                '&:hover fieldset': { borderColor: 'var(--accent-border)' },
                '&.Mui-focused fieldset': { borderColor: 'var(--accent)' },
              },
            }}
            slotProps={{ htmlInput: { 'data-testid': 'sourcing-worklist-search' } }}
          />
        </Box>

        {/* 4. Filters + sort */}
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 1.5, mb: 1.5, alignItems: { md: 'center' } }}>
          <Box data-testid="sourcing-worklist-filters" sx={{ display: 'flex', gap: 1 }}>
            <select
              aria-label="Supplier readiness"
              style={selectStyle}
              value={worklistSupplierReadiness ?? ''}
              onChange={(e) => { setWorklistPage(1); setWorklistSupplierReadiness((e.target.value || undefined) as SourcingWorklistParams['supplier_readiness']); }}
            >
              <option value="">Any supplier readiness</option>
              <option value="ready">Ready</option>
              <option value="needs_supplier">Needs supplier</option>
              <option value="no_history">No history</option>
            </select>
            <select
              aria-label="Purchasing stage"
              style={selectStyle}
              value={worklistPurchasingStage ?? ''}
              onChange={(e) => { setWorklistPage(1); setWorklistPurchasingStage((e.target.value || undefined) as SourcingWorklistParams['purchasing_stage']); }}
            >
              <option value="">Any purchasing stage</option>
              <option value="not_started">Not started</option>
              <option value="queued">Queued</option>
              <option value="draft">Draft</option>
              <option value="committed">Committed</option>
            </select>
            <select
              aria-label="Coverage"
              style={selectStyle}
              value={worklistCoverage ?? ''}
              onChange={(e) => { setWorklistPage(1); setWorklistCoverage((e.target.value || undefined) as SourcingWorklistParams['coverage']); }}
            >
              <option value="">Any coverage</option>
              <option value="short">Short</option>
              <option value="covered_inbound">Covered inbound</option>
            </select>
          </Box>
          <select
            data-testid="sourcing-worklist-sort"
            aria-label="Sort"
            style={selectStyle}
            value={worklistSort}
            onChange={(e) => { setWorklistPage(1); setWorklistSort(e.target.value as SourcingWorklistParams['sort']); }}
          >
            <option value="action_priority">Action priority</option>
            <option value="oldest_demand">Oldest demand</option>
            <option value="still_to_source">Still to source</option>
            <option value="stockout_soonest">Stockout soonest</option>
            <option value="product_az">Product A–Z</option>
          </select>
        </Box>

        {isLoadingWorklist && !worklist && (
          <Typography sx={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Loading sourcing worklist…</Typography>
        )}

        {!isLoadingWorklist && worklist && items.length === 0 && (
          <Box data-testid="sourcing-worklist-empty-state" sx={{ p: 3, textAlign: 'center', border: '1px dashed var(--rule)', borderRadius: '10px' }}>
            <Typography sx={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>Nothing needs sourcing right now</Typography>
            <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', mt: 0.5 }}>
              Every SKU in this view is covered, in progress, or has no open demand.
            </Typography>
          </Box>
        )}

        {/* 5. Worklist rows */}
        <Box>
          {items.map((item) => (
            <Box
              key={item.lasyncro_variant_id}
              data-testid={`sourcing-worklist-row-${item.lasyncro_variant_id}`}
              sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1.25, borderBottom: '1px solid var(--rule)' }}
            >
              {item.image_url ? (
                <Box component="img" src={item.image_url} alt={item.variant_title ?? item.product_title ?? ''} sx={{ width: 36, height: 36, objectFit: 'contain', borderRadius: '6px', border: '1px solid var(--rule)' }} />
              ) : (
                <Box data-testid="sourcing-worklist-image-placeholder" sx={{ width: 36, height: 36, borderRadius: '6px', border: '1px solid var(--rule)', bgcolor: 'var(--bg-3)' }} />
              )}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{item.product_title}</Typography>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
                  <Typography component="span" sx={{ fontSize: 12, color: 'var(--ink-3)' }}>{item.variant_title}</Typography>
                  <Typography component="span" sx={{ fontSize: 12, color: 'var(--ink-3)' }}>·</Typography>
                  <Typography component="span" sx={{ fontSize: 12, color: 'var(--ink-3)' }}>{item.sku}</Typography>
                </Box>
                <Typography data-testid="sourcing-worklist-row-reason" sx={{ fontSize: 12, color: 'var(--ink-3)', mt: 0.25 }}>
                  {reasonFor(item)}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>
                {rowActions(item)}
              </Box>
            </Box>
          ))}
        </Box>

        {/* 6. Canonical pagination footer — modules-ux-playbook.md §6. */}
        {totalItems > 0 && (
          <Box
            data-testid="sourcing-worklist-pagination"
            sx={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              px: 2, py: 1, mt: 1.5, bgcolor: 'var(--bg)', border: '1px solid var(--rule)', borderRadius: '10px',
              flexWrap: 'wrap', gap: 1,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Typography sx={{ fontSize: 11, color: 'var(--ink-3)' }}>
                {rangeStart}–{rangeEnd} of {totalItems}
              </Typography>
              <Box data-testid="sourcing-worklist-page-size" sx={{ display: 'flex', gap: 0.5 }}>
                {[10, 25, 50, 100].map((n) => (
                  <Box
                    key={n}
                    component="button"
                    type="button"
                    onClick={() => { setWorklistPageSize(n); setWorklistPage(1); }}
                    sx={{
                      px: 1, py: 0.25, fontSize: 10, fontFamily: 'inherit',
                      border: '0.5px solid',
                      borderColor: n === effectivePageSize ? 'var(--accent)' : 'var(--rule)',
                      borderRadius: '4px',
                      bgcolor: n === effectivePageSize ? 'var(--accent-ghost)' : 'var(--surface)',
                      color: n === effectivePageSize ? 'var(--accent)' : 'var(--ink-3)',
                      cursor: 'pointer', fontWeight: n === effectivePageSize ? 600 : 400,
                    }}
                  >
                    {n}
                  </Box>
                ))}
              </Box>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              {totalPages > 1 && (
                <Box
                  component="button"
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setWorklistPage((p) => Math.max(1, p - 1))}
                  sx={{
                    px: 1.5, py: 0.5, borderRadius: '6px', fontFamily: 'inherit',
                    cursor: currentPage > 1 ? 'pointer' : 'not-allowed',
                    border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)', fontSize: 12,
                    color: 'var(--ink-3)', opacity: currentPage > 1 ? 1 : 0.4,
                  }}
                >
                  Previous
                </Box>
              )}
              {totalPages > 1 && Array.from({ length: totalPages }, (_, i) => (
                <Box
                  key={i}
                  component="button"
                  type="button"
                  onClick={() => setWorklistPage(i + 1)}
                  sx={{
                    px: 1.5, py: 0.5, fontSize: 11, fontFamily: 'inherit',
                    border: '0.5px solid',
                    borderColor: i + 1 === currentPage ? 'var(--accent)' : 'var(--rule)',
                    borderRadius: '6px',
                    bgcolor: i + 1 === currentPage ? 'var(--accent)' : 'var(--surface)',
                    color: i + 1 === currentPage ? 'var(--accent-ink)' : 'var(--ink-3)',
                    cursor: 'pointer', fontWeight: i + 1 === currentPage ? 600 : 400,
                  }}
                >
                  {i + 1}
                </Box>
              ))}
              {totalPages > 1 && (
                <Box
                  component="button"
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setWorklistPage((p) => Math.min(totalPages, p + 1))}
                  sx={{
                    px: 1.5, py: 0.5, borderRadius: '6px', fontFamily: 'inherit',
                    cursor: currentPage < totalPages ? 'pointer' : 'not-allowed',
                    border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)', fontSize: 12,
                    color: 'var(--ink-3)', opacity: currentPage < totalPages ? 1 : 0.4,
                  }}
                >
                  Next
                </Box>
              )}
            </Box>
          </Box>
        )}

        {/* 7. MOQ grouped purchasing — approved exception, grouped by supplier,
            not per-SKU. Absent entirely when there is nothing queued (SRC-WL-2B-01). */}
        {reorderRequests.length > 0 && (
          <Box
            data-testid="moq-accumulator-entry"
            sx={{ mt: 2, p: 1.5, border: '1px solid var(--rule)', borderRadius: '10px', bgcolor: 'var(--surface)' }}
          >
            <Typography sx={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)' }}>
              Reorder queue · {reorderRequests.length} supplier{reorderRequests.length === 1 ? '' : 's'} pooling MOQ
            </Typography>
            {reorderRequests.map((group) => (
              <Box key={group.supplier_id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 0.75 }}>
                <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {group.supplier_name} · {group.total_qty}{group.moq ? ` / ${group.moq}` : ''} pooled
                </Typography>
                <Button
                  size="small"
                  variant="contained"
                  sx={tier1Sx}
                  disabled={convertingSupplierIds.has(group.supplier_id)}
                  onClick={() => handleConvertClick(group)}
                >
                  Convert to PO
                </Button>
                {convertErrors[group.supplier_id] && (
                  <Typography sx={{ fontSize: 11, color: 'error.main' }}>{convertErrors[group.supplier_id]}</Typography>
                )}
              </Box>
            ))}
          </Box>
        )}

        <AssignSupplierDialog
          open={assignOpen}
          target={assignTarget}
          suppliers={suppliers}
          onClose={() => setAssignOpen(false)}
          onSubmit={handleAssignSave}
        />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', lg: 'row' }, flexWrap: { xs: 'nowrap', lg: 'wrap' }, gap: 2.25, alignItems: 'stretch' }}>

        {/* DECISION CARD */}
        <Box sx={{ flex: { xs: '1 1 auto', lg: '1 1 0' }, minWidth: 0, bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', overflow: 'hidden' }}>
          <Box sx={{ p: '18px 20px', borderBottom: '1px solid var(--rule)' }}>
            <Typography sx={{ fontSize: 16, fontWeight: 500, color: 'var(--ink)' }}>Sourcing recommendations</Typography>
            <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)', mt: 0.25 }}>
              {activeVariantId ? 'Ranked by supplier reliability — on-time rate, fill rate, defect rate' : 'Select a stockout alert to see ranked supplier options'}
            </Typography>
          </Box>

          {/* SRC-L3-15: the deep link points at something this tenant does not
              own. Distinct from "no supplier history" — which is a statement
              about a product that DOES exist. */}
          {targetFetchState === 'not_found' && (
            <Box data-testid="sourcing-target-not-found" sx={{ px: 2.5, py: 2.5, borderBottom: '1px solid var(--rule)' }}>
              <Typography sx={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>
                We couldn’t find that product
              </Typography>
              <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)', mt: 0.5 }}>
                The link may be out of date, or the product may have been removed.
              </Typography>
            </Box>
          )}

          {/* SRC-L3-15A: we do not know what happened. Saying anything about
              the merchant's catalogue here would be a guess. */}
          {targetFetchState === 'error' && (
            <Box data-testid="sourcing-target-load-error" sx={{ px: 2.5, py: 2.5, borderBottom: '1px solid var(--rule)' }}>
              <Typography sx={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>
                Couldn’t load sourcing details
              </Typography>
              <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)', mt: 0.5 }}>
                Something went wrong on our side — the product and its suppliers are unaffected.
              </Typography>
            </Box>
          )}

          {/* SRC-L3-02/04/10/11/14 — TARGETED RECOVERY HEADER.
              Identity first (what am I looking at?), then purchasing truth
              (how many do I actually need to buy?), and only then the ranked
              suppliers below. Every number is the server's; none is
              recomputed here. */}
          {activeVariantId && targetFetchState === 'ok' && targeted && (
            <>
              {/* MEDIA + DECISION. The media column exists to let a merchant
                  recognise the SKU on sight; everything to its right answers
                  what to do about it. */}
              <Box data-testid="sourcing-identity" sx={{ display: 'flex', flexDirection: { xs: 'column', lg: 'row' }, alignItems: 'stretch', borderBottom: '1px solid var(--rule)' }}>
                {targeted.image_url && (
                  /* SRC-ACT-UI-10: a 48px chip is an icon, not recognition.
                     `contain`, never `cover` — a product cropped to a square
                     can read as a different product. Bounded height so a
                     low-resolution image is not stretched to absurdity. */
                  <Box
                    data-testid="sourcing-product-media"
                    sx={{
                      flex: { xs: '1 1 auto', lg: '0 0 32%' },
                      minWidth: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: 'var(--bg-2)',
                      borderBottom: { xs: '1px solid var(--rule)', lg: 'none' },
                      borderRight: { xs: 'none', lg: '1px solid var(--rule)' },
                      p: 2,
                    }}
                  >
                    <Box
                      component="img"
                      src={targeted.image_url}
                      alt={targeted.product_title ?? 'Product'}
                      sx={{ maxWidth: '100%', maxHeight: 220, objectFit: 'contain', borderRadius: 1 }}
                    />
                  </Box>
                )}

                {/* The decision column. With no image it takes the full width
                    rather than sharing it with an empty frame (SRC-ACT-UI-11). */}
                <Box sx={{ flex: '1 1 0', minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2.5, py: 2 }}>
                    {!targeted.image_url && (
                      /* SRC-L3-03: an explicit placeholder, never an <img> with
                         no source — a broken-image glyph reads as a bug, not as
                         "this product has no photo". */
                      <Box
                        data-testid="sourcing-identity-placeholder"
                        aria-hidden="true"
                        sx={{ width: 48, height: 48, borderRadius: 1, flexShrink: 0, bgcolor: 'var(--bg-2)', border: '1px solid var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Package size={18} color="var(--ink-4)" />
                      </Box>
                    )}
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{targeted.product_title}</Typography>
                      <Typography sx={{ fontSize: 12.5, fontWeight: 300, color: 'var(--ink-2)' }}>{targeted.variant_title}</Typography>
                      <Typography sx={{ fontSize: 11.5, fontWeight: 300, color: 'var(--ink-4)', mt: 0.25 }}>{targeted.sku}</Typography>
                    </Box>
                  </Box>

                  {/* Truth beside action on a wide screen; stacked when narrow.
                      No horizontal scroll at any width. */}
                  <Box sx={{ display: 'flex', flexDirection: { xs: 'column', lg: 'row' }, alignItems: 'stretch', borderTop: '1px solid var(--rule)' }}>

              <Box data-testid="sourcing-gap-summary" sx={{ flex: { xs: '1 1 auto', lg: '1 1 0' }, minWidth: 0, px: 2.5, py: 2, bgcolor: 'var(--bg-2)' }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 3, flexWrap: 'wrap' }}>
                  {/* Still to source is the number the merchant acts on, so it
                      is the one that carries the visual weight. */}
                  <Box>
                    <Typography sx={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                      Still to source
                    </Typography>
                    <Typography sx={{ fontSize: 26, fontWeight: 600, lineHeight: 1.1, color: 'var(--ink)' }}>
                      {targeted.still_to_source}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 2.5, flexWrap: 'wrap', pb: 0.5 }}>
                    {([
                      ['Open demand', targeted.open_demand],
                      ['Available',   targeted.available],
                      ['Inbound',     targeted.committed_inbound],
                      ['Short now',   targeted.short_now],
                    ] as const).map(([label, value]) => (
                      <Box key={label}>
                        <Typography sx={{ fontSize: 10.5, fontWeight: 500, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                          {label}
                        </Typography>
                        <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'var(--ink-2)' }}>{value}</Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>

                {/* SRC-L3-10/11: who is waiting, and which order sent you here.
                    Both are server-derived context — never inputs to the
                    numbers above. */}
                {targeted.blocking_orders && targeted.blocking_orders.length > 0 && (() => {
                  const originating = targeted.originating_order_id
                    ? targeted.blocking_orders.find(o => o.order_id === targeted.originating_order_id)
                    : undefined;
                  const count = targeted.blocking_orders.length;
                  return (
                    <Typography sx={{ fontSize: 11.5, fontWeight: 300, color: 'var(--ink-3)', mt: 1.25 }}>
                      {count} {count === 1 ? 'order' : 'orders'} blocked
                      {originating && (
                        <> · you came from order {originating.external_order_id ?? originating.order_id}</>
                      )}
                    </Typography>
                  );
                })()}
              </Box>
              {/* SRC-ACT-UI-01…08 — ONE DOMINANT NEXT ACTION.
                  The resolver above decides which; this only renders it. A
                  secondary path appears when the ratified state has one, and
                  is deliberately quieter — same row, plain text, no fill. */}
              {targetedAction && (
                <Box sx={{ flex: { xs: '1 1 auto', lg: '0 0 40%' }, minWidth: 0, px: 2.5, py: 2, borderTop: { xs: '1px solid var(--rule)', lg: 'none' }, borderLeft: { xs: 'none', lg: '1px solid var(--rule)' } }}>
                  {/* SRC-ACT-UI-12/13: the quantity belongs to the action that
                      spends it. In a continuation state — inbound already
                      covering the need, a queue or a draft already carrying it
                      — there is no new purchase, so asking "how many?" is a
                      question with no answer. It appears only when a new
                      purchasing action is on offer. */}
                  {isNewPurchaseAction && (
                    <Box sx={{ mb: 1.75 }}>
                      <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>
                        Order quantity
                      </Typography>
                      {/* SRC-12: the line states WHICH number is in the box. A
                          fallback that looks like a forecast is worse than no
                          number at all. */}
                      <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mt: 0.25 }}>
                        {quantityBasis === 'planning_data_required' ? (
                          <>
                            No supplier lead time —{' '}
                            <Box
                              component="span"
                              onClick={() => sourcingNavigate('/suppliers-portal/suppliers')}
                              sx={{ color: 'var(--accent-text)', cursor: 'pointer', textDecoration: 'underline', '&:hover': { opacity: 0.75 } }}
                            >
                              set one
                            </Box>
                            {' '}for a forecast
                          </>
                        ) : quantityBasis === 'no_signal'
                          ? 'No sales history · enter a quantity if you know the demand'
                          : quantityBasis === 'preventive'
                            ? (planningContext?.target_coverage_days != null
                                ? `${shortfallBasis?.demand ?? 0} ordered · ${shortfallBasis?.available ?? 0} in stock · covers ${planningContext.target_coverage_days} days`
                                : `${shortfallBasis?.demand ?? 0} ordered · ${shortfallBasis?.available ?? 0} in stock · forecast incl. lead time`)
                            : shortfall > 0
                              ? `${shortfallBasis?.demand ?? 0} ordered · ${shortfallBasis?.available ?? 0} in stock · ${shortfall} short`
                              : `${shortfallBasis?.demand ?? 0} ordered · ${shortfallBasis?.available ?? 0} in stock · covered`}
                      </Typography>
                      {/* SRC-12: no input when the merchant has a supplier but no
                          lead time on it. There is no honest quantity to propose
                          and no operator knowledge that fills the gap — the
                          missing piece is data, and the line above links to where
                          it is entered. Every other state keeps the input,
                          including no_signal: a brand-new product has no history,
                          but the merchant may well know they are launching it. */}
                      {quantityBasis !== 'planning_data_required' && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75 }}>
                        <Box
                          component="input"
                          data-testid="sourcing-purchase-quantity"
                          type="number"
                          min={0}
                          value={queueQty}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                            const next = parseInt(e.target.value, 10);
                            setQueueQty(Number.isNaN(next) || next < 0 ? 0 : next);
                          }}
                          sx={{ width: 72, fontSize: 13, textAlign: 'right', color: 'var(--ink)', bgcolor: 'var(--surface)', border: '0.5px solid var(--rule)', borderRadius: '6px', px: 1, py: 0.75, '&:focus': { outline: 'none', borderColor: 'var(--accent)' } }}
                        />
                        <Typography sx={{ fontSize: 12, color: 'var(--ink-4)' }}>units</Typography>
                        {queueQty !== prefillQty && (
                          <Box component="button" onClick={() => setQueueQty(prefillQty)}
                            sx={{ fontSize: 11, color: 'var(--accent-text)', bgcolor: 'transparent', border: 'none', cursor: 'pointer', px: 0.5, '&:hover': { opacity: 0.75 } }}>
                            Reset
                          </Box>
                        )}
                      </Box>
                      )}
                    </Box>
                  )}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                    <Box
                      component="button"
                      data-testid="sourcing-primary-action"
                      onClick={targetedAction.primary.onClick}
                      sx={{ display: 'inline-flex', alignItems: 'center', fontSize: 13, fontWeight: 600,
                        color: 'var(--accent-ink)', bgcolor: 'var(--accent)', border: 'none',
                        borderRadius: '6px', px: 2, py: 1, cursor: 'pointer',
                        '&:hover': { opacity: 0.88 } }}
                    >
                      {targetedAction.primary.label}
                    </Box>
                    {targetedAction.secondary && (
                      <Box
                        component="button"
                        data-testid="sourcing-secondary-action"
                        onClick={targetedAction.secondary.onClick}
                        sx={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 400,
                          color: 'var(--ink-3)', bgcolor: 'transparent', border: 'none',
                          textDecoration: 'underline', px: 0.5, py: 1, cursor: 'pointer',
                          '&:hover': { color: 'var(--ink)' } }}
                      >
                        {targetedAction.secondary.label}
                      </Box>
                    )}
                  </Box>
                  {targetedAction.note && (
                    <Typography sx={{ fontSize: 11.5, fontWeight: 300, color: 'var(--ink-3)', mt: 1 }}>
                      {targetedAction.note}
                    </Typography>
                  )}
                </Box>
              )}

                  </Box>
                </Box>
              </Box>
            </>
          )}

          {/* §7.6 ISS-SR-06: no variantId → show preferences + never-ordered instead of empty state.
              Slice 1A: preference ADMINISTRATION is portfolio housekeeping. It
              competed with a single urgent recovery, so it stays where it
              belongs — the untargeted view. Unchanged when no variantId. */}
          {!activeVariantId && (
            <Box sx={{ borderBottom: '1px solid var(--rule)' }}>
              <Box sx={{ px: 2.5, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography sx={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                  Supplier preferences
                </Typography>
                {!isLoadingPrefs && preferences.length === 0 && (
                  <Typography sx={{ fontSize: 12, color: 'var(--ink-4)' }}>None set</Typography>
                )}
              </Box>
              {isLoadingPrefs && <Box sx={{ px: 2.5, pb: 2 }}><ModuleLoadingSkeleton rows={1} height={16} /></Box>}
              {!isLoadingPrefs && preferences.length > 0 && (
                <>
                  {(['variant', 'product', 'product_type'] as const).map((scope) => {
                    const rows = prefsByScope[scope];
                    if (!rows.length) return null;
                    return (
                      <Box key={scope}>
                        <Box sx={{ px: 2.5, py: 0.75, bgcolor: 'var(--bg-2)' }}>
                          <Typography sx={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                            {scopeLabels[scope]}
                          </Typography>
                        </Box>
                        {rows.map((pref) => (
                          <Box key={pref.id} sx={{ display: 'flex', alignItems: 'center', px: 2.5, py: 1.5, borderTop: '1px solid var(--rule)', gap: 1.5 }}>
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{pref.supplier_name}</Typography>
                                <Chip label={pref.priority === 1 ? 'Primary' : 'Backup'} size="small"
                                  sx={{ fontSize: 10, height: 18, bgcolor: pref.priority === 1 ? 'rgba(255,107,43,0.12)' : 'action.hover', color: pref.priority === 1 ? 'var(--accent)' : 'text.secondary' }} />
                              </Box>
                              <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'monospace', mt: 0.25 }}>{pref.scope_id}</Typography>
                              {pref.note && <Typography sx={{ fontSize: 11, color: 'var(--ink-3)', mt: 0.25, fontStyle: 'italic' }}>{pref.note}</Typography>}
                            </Box>
                            <IconButton size="small" onClick={() => void handleDeletePreference(pref.id)}
                              sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}>
                              <Trash2 size={14} />
                            </IconButton>
                          </Box>
                        ))}
                      </Box>
                    );
                  })}
                </>
              )}
            </Box>
          )}

          {activeVariantId && isLoadingRecs && (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>Loading recommendations…</Typography>
            </Box>
          )}

          {/* SRC-L3-15: a statement about a product that EXISTS. Gated on a
              successful fetch so a 404 or a 5xx can never borrow it. */}
          {activeVariantId && targetFetchState === 'ok' && targeted && !isLoadingRecs && recommendations.length === 0 && (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }}>No supplier history for this product yet.</Typography>
            </Box>
          )}

          {/* SRC-ACT-UI-08: the "Your best supplier, ranked automatically"
              coachmark was gated on activeVariantId, so it only ever appeared
              during a targeted recovery — precisely where a portfolio
              onboarding card competes with the purchasing decision. Removed
              rather than relocated: there was no generic-mode instance to
              preserve. */}
          {/* SRC-03: gated on recommendations, not goodMatches — the shortfall
              belongs to the VARIANT, so it must show even when every candidate
              is demoted for exceeding MOQ. Gating on goodMatches hid both the
              quantity and its basis in exactly the case where the operator most
              needs them: deciding whether to order under a large minimum. */}
          {/* SRC-12: no longer gated on recommendations.length. A variant with
              no supplier and no history rendered NOTHING — the operator saw a
              blank space and could not tell whether the page was broken or the
              data was missing. It now says which. */}
          {/* SRC-ACT-UI-12/13: the standalone "Order quantity" row used to render
              for every targeted state, including ones with nothing left to buy —
              a zero-unit input beside "covered by inbound". It now lives with the
              action that spends it, inside the Next Action area above, and only
              when a new purchase is actually on offer. */}

          {/* SRC-L3-14: suppliers answer the question AFTER identity and
              purchasing truth have framed it. */}
          <Box data-testid="sourcing-supplier-candidates">
          {goodMatches.map((rec) => (
            <Box key={rec.id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2.5, py: 1.75, borderTop: '1px solid var(--rule)' }}>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>{rec.name}</Typography>
                  {rec.is_preferred && (
                    <Chip label="★ Preferred" size="small"
                      sx={{ fontSize: 10, height: 18, bgcolor: 'var(--accent-ghost)', color: 'var(--accent-text)' }} />
                  )}
                </Box>
                <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>
                  {(() => {
                    const parts = [
                      rec.on_time_rate != null && `On-time ${rec.on_time_rate}%`,
                      rec.fill_rate != null && `Fill ${rec.fill_rate}%`,
                      rec.lead_time_days != null && `Lead ${rec.lead_time_days}d`,
                      // SRC-06: the actionable number. "445 more units to reach
                      // their 500 minimum" tells the merchant what queueing
                      // achieves; "Exceeds MOQ" told them to go elsewhere.
                      rec.moq != null && rec.units_to_moq > 0 &&
                        `${rec.units_to_moq} more to reach their ${rec.moq} minimum`,
                      rec.moq != null && rec.units_to_moq === 0 &&
                        `Meets their ${rec.moq} minimum`,
                    ].filter(Boolean);
                    return parts.length > 0 ? parts.join(' · ') : 'No order history yet';
                  })()}
                </Typography>
              </Box>
              {/* SRC-ACT-UI-08: in targeted mode the target-level resolver owns
                  purchasing action hierarchy. Two equally-weighted buttons on
                  every row is what made the surface unreadable from a blocked
                  order. Generic Sourcing keeps its row actions unchanged. */}
              {!isTargetedMode && (
              <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                {/* §8: queue to accumulator — loading + added flash states prevent ghost clicks */}
                {(() => {
                  const btnState = queueButtonState[rec.id] ?? 'idle';
                  const isAdding = btnState === 'adding';
                  const isAdded  = btnState === 'added';
                  return (
                    <Box component="button"
                      onClick={() => activeVariantId && btnState === 'idle' && void handleAddToQueue(activeVariantId, rec.id)}
                      sx={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 500,
                        color: isAdded ? 'var(--confirm-ink)' : 'var(--accent)',
                        bgcolor: isAdded ? 'var(--confirm-ghost)' : 'transparent',
                        border: `0.5px solid ${isAdded ? 'var(--confirm-border)' : 'var(--accent)'}`,
                        borderRadius: '6px', px: 1.25, py: 0.75,
                        cursor: btnState === 'idle' ? 'pointer' : 'default',
                        transition: 'all 0.2s',
                        '&:hover': { opacity: btnState === 'idle' ? 0.75 : 1 } }}>
                      {isAdding ? 'Adding…' : isAdded ? 'Added ✓' : 'Add to queue →'}
                    </Box>
                  );
                })()}
                <Box component="button" onClick={() => activeVariantId && handleCreatePoFromRec(activeVariantId, rec.id)}
                  sx={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, color: 'var(--accent-ink)', bgcolor: 'var(--accent)', border: 'none', borderRadius: '6px', px: 1.25, py: 0.75, cursor: 'pointer', '&:hover': { opacity: 0.88 } }}>
                  Create PO →
                </Box>
              </Box>
              )}
            </Box>
          ))}
          </Box>


          {/* §8 post-convert confirmation — state lives at page level to survive refetch */}
          {lastConvertedPoId && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2.5, py: 1.5, borderTop: '1px solid var(--rule)', bgcolor: 'var(--accent-ghost)' }}>
              <Typography sx={{ fontSize: 12, color: 'var(--accent-text)', fontWeight: 500 }}>
                Draft PO created — check Open POs to review and send.
              </Typography>
              <Box component="button" onClick={() => onDismissConvertedPo?.()}
                sx={{ display: 'inline-flex', alignItems: 'center', fontSize: 11, fontWeight: 500, color: 'var(--accent-text)', bgcolor: 'transparent', border: '0.5px solid var(--accent)', borderRadius: '6px', px: 1, py: 0.5, cursor: 'pointer', '&:hover': { opacity: 0.75 } }}>
                Dismiss
              </Box>
            </Box>
          )}

          {/* §8 Pending Reorders — always visible when accumulator has items */}
          {reorderRequests.length > 0 && (
            <Box ref={pendingReordersRef} sx={{ borderTop: '1px solid var(--rule)' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, px: 2.5, py: 1.5, bgcolor: 'var(--bg-2)' }}>
                <Typography sx={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                  Pending reorders · {reorderRequests.length} supplier{reorderRequests.length > 1 ? 's' : ''}
                </Typography>
                {/* SRC-09: a colour that needs decoding is not a signal. Local
                    rather than FT2Legend, whose item type carries no colour and
                    whose contract reads "Never instructional. Never semantic." */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                  {([
                    ['var(--good-ink)',     'Ready to send'],
                    ['var(--warning-ink)',  'Below minimum'],
                    ['var(--critical-ink)', 'Blocked'],
                  ] as const).map(([tone, label]) => (
                    <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Box sx={{ width: 8, height: 3, borderRadius: 1.5, bgcolor: tone, flexShrink: 0 }} />
                      <Typography sx={{ fontSize: 10, color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>{label}</Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
              {/* Spotlight 3 — fires first time accumulator has items */}
              {spotlights && !spotlights.accumulator.isDismissed && (
                <Box sx={{ px: 2.5, pt: 1.5 }}>
                  <SpotlightCoachMark
                    title="Building up your order before sending"
                    body="Products queue here by supplier. Create PO unlocks once the supplier has a delivery time set and every line has a SKU. If you're under their minimum order, you can still send early — we'll note it on the PO."
                    isDismissed={spotlights.accumulator.isDismissed}
                    onDismiss={spotlights.accumulator.dismiss}
                    step={3}
                    totalSteps={3}
                  />
                </Box>
              )}
              {reorderRequests.map((group) => {
                const moqPct = group.moq ? Math.min(100, Math.round((group.total_qty / group.moq) * 100)) : null;
                const converting = convertingSupplierIds.has(group.supplier_id);
                // SRC-01b: hard gates (G3 lead time, G4 SKU) disable the button.
                // The soft MOQ gate leaves it enabled and routes to a confirm.
                const hardBlocked = !group.gates.lead_time_set || !group.gates.all_lines_have_sku;
                const hardReason  = !group.gates.lead_time_set
                  ? 'Set a delivery time for this supplier to order'
                  : 'Some queued lines have no SKU — add one to order';
                const convertError = convertErrors[group.supplier_id];

                // SRC-09: one live-status colour drives both the bar and its
                // label. Grey-for-everything hid the difference between 5/500
                // and 480/500, and between "queue more" and "you cannot order
                // at all until you fix something".
                //
                // --good/--warning/--critical are the theme's live-status
                // family (see themes/index.tsx). Deliberately NOT --confirm-*,
                // which the theme scopes to confirmed ACTIONS ("Added ✓") —
                // this is a computed condition, and the two tokens diverge in
                // dark theme (#4CAF7A vs #66BB6A).
                const moqTone = hardBlocked
                  ? 'var(--critical-ink)'
                  : group.po_ready
                    ? 'var(--good-ink)'
                    : 'var(--warning-ink)';
                
                return (
                  <Box key={group.supplier_id} sx={{ px: 2.5, py: 1.75, borderTop: '1px solid var(--rule)' }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1, mb: 1 }}>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography sx={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>{group.supplier_name}</Typography>
                        <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mt: 0.25 }}>
                          {group.requests.slice(0, 3).map(r => `${r.sku ?? r.title ?? '?'} ${r.qty_requested}u`).join(' · ')}
                          {group.requests.length > 3 ? ` · +${group.requests.length - 3} more` : ''}
                        </Typography>
                      </Box>
                      {hardBlocked ? (
                        <Box component="button" disabled title={hardReason}
                          sx={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 500, color: 'var(--ink-4)', bgcolor: 'transparent', border: '0.5px solid var(--rule)', borderRadius: '6px', px: 1.25, py: 0.75, cursor: 'not-allowed', flexShrink: 0 }}>
                          Create PO →
                        </Box>
                      ) : group.po_ready ? (
                        <Box component="button" onClick={() => !converting && handleConvertClick(group)}
                          sx={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, color: 'var(--accent-ink)', bgcolor: 'var(--accent)', border: 'none', borderRadius: '6px', px: 1.25, py: 0.75, cursor: converting ? 'wait' : 'pointer', '&:hover': { opacity: 0.88 }, flexShrink: 0 }}>
                          {converting ? 'Creating…' : 'Create PO →'}
                        </Box>
                      ) : (
                        <Box component="button" onClick={() => !converting && handleConvertClick(group)}
                          sx={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 500, color: 'var(--accent-text)', bgcolor: 'transparent', border: '0.5px solid var(--accent)', borderRadius: '6px', px: 1.25, py: 0.75, cursor: converting ? 'wait' : 'pointer', '&:hover': { opacity: 0.75 }, flexShrink: 0 }}>
                          {converting ? 'Creating…' : 'Create PO anyway →'}
                        </Box>
                      )}
                    </Box>
                    {/* MOQ progress bar — only when supplier has a set MOQ */}
                    {group.moq !== null && (
                      <Box>
                        <Box sx={{ height: 4, borderRadius: 2, bgcolor: 'var(--bg-3)', overflow: 'hidden', mb: 0.5 }}>
                          <Box sx={{ height: '100%', width: `${moqPct}%`, bgcolor: moqTone, borderRadius: 2, transition: 'width 0.3s, background-color 0.3s' }} />
                        </Box>
                        <Typography sx={{ fontSize: 10, fontWeight: 500, color: moqTone }}>
                          {group.total_qty} / {group.moq} units{group.moq_met ? ' — MOQ met' : ' — MOQ not met'}
                        </Typography>
                      </Box>
                    )}
                    {/* SRC-01b: name the blocking gate inline — the disabled
                        button alone does not tell the operator what to fix. */}
                    {hardBlocked && (
                      <Typography sx={{ fontSize: 10, color: 'var(--ink-4)', mt: 0.5 }}>
                        {hardReason}
                      </Typography>
                    )}
                    {convertError && (
                      <Typography sx={{ fontSize: 10, color: 'var(--critical-text)', mt: 0.5 }}>
                        {convertError}
                      </Typography>
                    )}
                  </Box>
                );
              })}
            </Box>
          )}

          {/* SRC-01b: under-MOQ confirm — the override is recorded on the
                  PO notes, so it must be a deliberate choice, not a stray click. */}
              <Dialog open={moqConfirmGroup !== null} onClose={() => setMoqConfirmGroup(null)} fullWidth maxWidth="xs">
                <DialogTitle>Order below minimum?</DialogTitle>
                <DialogContent>
                  <Typography sx={{ fontSize: 13.5 }}>
                    {moqConfirmGroup?.supplier_name} asks for {moqConfirmGroup?.moq} units minimum.
                    You have {moqConfirmGroup?.total_qty} queued.
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: 'var(--ink-4)', mt: 1 }}>
                    The PO will be marked as a below-minimum order so you and the supplier both see why.
                  </Typography>
                </DialogContent>
                <DialogActions>
                  <Button onClick={() => setMoqConfirmGroup(null)}>Cancel</Button>
                  <Button
                    onClick={() => {
                      const id = moqConfirmGroup!.supplier_id;
                      setMoqConfirmGroup(null);
                      void handleConvert(id, true);
                    }}
                  >
                    Order anyway
                  </Button>
                </DialogActions>
              </Dialog>

          {/*
            §6a Branch B: never-ordered group.
            SOURCING-UX-COGNITIVE-01 Slice 1A: hidden in targeted mode. It is
            portfolio backlog about OTHER products, and it competed for
            attention with an urgent single-variant recovery. Unchanged when
            no variantId is supplied.
          */}
          {!activeVariantId && neverOrderedCount > 0 && (
            <Box sx={{ borderTop: '1px solid var(--rule)' }}>
              <Box sx={{ px: 2.5, py: 1.5, bgcolor: 'var(--bg-2)' }}>
                <Typography sx={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                  Never ordered before · {neverOrderedCount}
                </Typography>
              </Box>
              {/* Spotlight 1 — fires on first visit when never-ordered list is non-empty */}
              {spotlights && !spotlights.neverOrdered.isDismissed && (
                <Box sx={{ px: 2.5, pt: 1.5 }}>
                  <SpotlightCoachMark
                    title="These products have no supplier yet"
                    body="Assign a supplier to each one — so when stock runs low, you already know who to order from."
                    isDismissed={spotlights.neverOrdered.isDismissed}
                    onDismiss={spotlights.neverOrdered.dismiss}
                    step={1}
                    totalSteps={3}
                  />
                </Box>
              )}
              {neverOrdered.slice(0, 4).map((v) => (
                <Box key={v.lasyncro_variant_id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2.5, py: 1.75, borderTop: '1px solid var(--rule)' }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>
                      {v.product_title ?? v.title} {v.sku ? `· ${v.sku}` : ''}
                    </Typography>
                    {!v.has_sku && (
                      <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mt: 0.25 }}>
                        No SKU — add one in Shopify to enable ordering
                      </Typography>
                    )}
                  </Box>
                  {/* §7.6 ISS-SR-03: wired — opens AssignSupplierDialog */}
                  <Box component="button" onClick={() => handleAssignOpen(v)}
                    sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 500, color: 'var(--accent-text)', bgcolor: 'transparent', border: '0.5px solid var(--accent)', borderRadius: '6px', px: 1.25, py: 0.75, cursor: 'pointer', '&:hover': { opacity: 0.75 } }}>
                    Assign a supplier →
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </Box>

        {/*
          PULSE CARD — migrated to shared PulseCard, PULSE-01.
          Slice 1A: suppressed in targeted mode — a portfolio summary beside
          one urgent recovery task is competing noise. Unchanged otherwise.
        */}
        {!activeVariantId && (
        <Box sx={{ flex: { xs: '1 0 300px', lg: '0 0 300px' }, minWidth: 0 }}>
          <PulseCard
            title="Sourcing pulse"
            headline={{
              value: String(neverOrderedCount),
              tone: neverOrderedCount > 0 ? 'warning' : 'good',
              subtext: neverOrderedCount > 0 ? 'never ordered — no supplier assigned yet' : 'all SKUs have a supplier',
            }}
            rows={[
              {
                id: 'never-ordered',
                label: 'Never ordered before',
                value: neverOrderedCount,
                tone: neverOrderedCount > 0 ? 'warning' : 'good',
              },
              {
                id: 'ready-to-order',
                label: 'Ready to order',
                value: goodMatches.length,
              },
              {
                id: 'preferences-set',
                label: 'Preferences set',
                value: preferences.length,
              },
              {
                id: 'queued-for-reorder',
                label: 'Queued for reorder',
                value: reorderRequests.reduce((sum, g) => sum + g.requests.length, 0),
              },
            ]}
          />
        </Box>
        )}
      </Box>

      <CreatePoDialog
        open={createPoOpen}
        suppliers={suppliers}
        onClose={() => setCreatePoOpen(false)}
        onCreatePo={onCreatePo}
        onSearchVariants={onSearchVariants}
        prefilledLineItem={targetedPoLineItem}
        prefilledSupplierId={poSupplierId}
      />

      <AssignSupplierDialog
        open={assignOpen}
        target={assignTarget}
        suppliers={suppliers}
        onClose={() => setAssignOpen(false)}
        onSubmit={handleAssignSave}
      />
    </Box>
  );
}

function SuppliersPortalModuleFT2Inner(props: SuppliersPortalPageProps) {  
  if (props.view === 'suppliers') return <PurchasingSuppliersView {...props} />;
  if (props.view === 'sourcing') return <PurchasingSourcingView {...props} />;
  return <PurchasingPosView {...props} />;
};

export default function SuppliersPortalModuleFT2(props: SuppliersPortalPageProps) {
  const [searchParams] = useSearchParams();
  const autoOpenCreatePo = searchParams.get('action') === 'create-po';
  const autoOpenReceivePoId =
    searchParams.get('action') === 'receive'
      ? searchParams.get('poId') ?? undefined
      : undefined;
  const prefilledLineItem = autoOpenCreatePo
    ? {
        description: searchParams.get('description') ?? searchParams.get('sku') ?? '',
        quantity_ordered: Number(searchParams.get('qty') ?? 0) || 0,
        lasyncro_variant_id: searchParams.get('variantId') ?? undefined,
      }
    : undefined;
  return (
    <ModuleErrorBoundary moduleName="suppliers-portal">
      <SuppliersPortalModuleFT2Inner
        {...props}
        autoOpenCreatePo={autoOpenCreatePo}
        autoOpenReceivePoId={autoOpenReceivePoId}
        prefilledLineItem={prefilledLineItem}
      />
    </ModuleErrorBoundary>
  );
}
