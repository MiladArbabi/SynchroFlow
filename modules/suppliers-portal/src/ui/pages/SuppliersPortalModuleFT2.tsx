// modules/suppliers-portal/src/ui/pages/SuppliersPortalModuleFT2.tsx
import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box,
  Paper,
  Typography,
  Alert,
  Chip,
  useTheme,
  Divider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
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
  MenuItem,
  IconButton,
} from '@mui/material';
import { Truck, Star, Clock, ChevronDown, Package, CheckCircle, XCircle, Plus, Trash2 } from 'lucide-react';
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
};

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

export type CreatePoInput = {
  supplier_id: number;
  expected_delivery_date?: string;
  notes?: string;
  line_items: {
    description: string;
    quantity_ordered: number;
    unit_cost_cents?: number;
    lasyncro_variant_id?: string | null;
  }[];
};

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
  exceeds_moq: boolean;
  // §7.8 preference fields
  is_preferred: boolean;
  preference_tier: 1 | 2 | null;
  preference_priority: number | null;
  preference_scope: string | null;
  preference_note: string | null;
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
  total_qty: number;
  moq_met: boolean;
  requests: ReorderRequest[];
};

export type SuppliersPortalData = {
  purchase_orders: PurchaseOrder[];
  suppliers: Supplier[];
  never_ordered: { lasyncro_variant_id: string; sku: string | null; title: string; product_title: string | null; product_id: string | null; product_type: string | null; has_sku: boolean }[];
  never_ordered_count: number;
} | null;

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
  onCreatePo: (input: CreatePoInput) => Promise<void>;
  /** Creates a WMS receive job for a shipped PO. Navigates operator to receive session. */
  onCreateReceiveJob: (poId: string) => Promise<{ receive_job_id: string }>;
  onSearchVariants: (q: string) => Promise<VariantOption[]>;
  /** Sourcing (Thread C): ranked supplier recommendations for onevariant, fetched on demand. */
  onFetchSourcingRecommendations: (variantId: string, neededQty?: number) => Promise<SourcingRecommendation[]>;
  // §7.7 Preference CRUD
  onFetchPreferences: () => Promise<PreferenceRow[]>;
  onCreatePreference: (input: { supplier_id: number; scope_type: string; scope_id: string; priority?: number; note?: string }) => Promise<PreferenceRow>;
  onUpdatePreference: (id: string, input: { priority?: number; note?: string }) => Promise<PreferenceRow>;
  onDeletePreference: (id: string) => Promise<void>;
  // §8 MOQ Accumulation — sourcing-recommendation-playbook.md §8
  onFetchReorderRequests: () => Promise<SupplierAccumulation[]>;
  onCreateReorderRequest: (input: { lasyncro_variant_id: string; supplier_id: number; qty_requested: number; source: 'alert' | 'manual' }) => Promise<ReorderRequest>;
  onDeleteReorderRequest: (id: string) => Promise<void>;
  onConvertReorderRequests: (supplierId: number) => Promise<{ po_id: string }>;
  /** §8: set by page after convert survives refetch re-render — cleared by dismiss */
  lastConvertedPoId?: string | null;
  onDismissConvertedPo?: () => void;
  /** Onboarding spotlights — resolved via useSpotlight() at page level */
  spotlights?: {
    neverOrdered:   { isDismissed: boolean; dismiss: () => void };
    alertTriggered: { isDismissed: boolean; dismiss: () => void };
    accumulator:    { isDismissed: boolean; dismiss: () => void };
    poSendFlow:     { isDismissed: boolean; dismiss: () => void };
  };
  /** When true, auto-opens the Create PO dialog on mount */
  autoOpenCreatePo?: boolean;
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
  onCreateSupplier,
  onCreatePo,
  onSearchVariants,
  prefilledLineItem,
  prefilledSupplierId,
}: {
  open: boolean;
  suppliers: Supplier[];
  onClose: () => void;
  onCreateSupplier: (input: CreateSupplierInput) => Promise<Supplier>;
  onCreatePo: (input: CreatePoInput) => Promise<void>;
  /** Creates a WMS receive job for a shipped PO. Navigates operator to receive session. */
  onSearchVariants: (q: string) => Promise<VariantOption[]>;
  prefilledLineItem?: { description: string; quantity_ordered: number; lasyncro_variant_id?: string };
  /** Sourcing (Thread C): pre-select the recommended supplier when opened from Sourcing. */
  prefilledSupplierId?: number;
}) {
  const [supplierId, setSupplierId] = useState<string>(prefilledSupplierId ? String(prefilledSupplierId) : '');
  const [newSupplier, setNewSupplier] = useState({ name: '', contact_name: '', contact_email: '', contact_phone: '', moq: '', lead_time_days: '' });
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([
    { key: 0, description: '', quantity_ordered: '', unit_cost_cents: '' },
  ]);
  // REPL-001: seed first line from a reorder deep-link (Demand → Order →). Qty stays editable (MOQ-aware-ready).
  useEffect(() => {
    if (prefilledLineItem && prefilledLineItem.description) {
      setLineItems([{
        key: 0,
        description: prefilledLineItem.description,
        quantity_ordered: prefilledLineItem.quantity_ordered ? String(prefilledLineItem.quantity_ordered) : '',
        unit_cost_cents: '',
      }]);
    }
  }, [prefilledLineItem]);
  const [submitting, setSubmitting] = useState(false);
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
    setError(null);

    // Validate supplier
    if (!supplierId) return setError('Please select a supplier.');
    if (isNewSupplier && !newSupplier.name.trim()) return setError('New supplier name is required.');

    // Validate line items
    for (const item of lineItems) {
      if (!item.description.trim()) return setError('All line items need a description.');
      const qty = parseInt(item.quantity_ordered, 10);
      if (isNaN(qty) || qty < 1) return setError('All line items need a valid quantity (≥ 1).');
      if (!item.lasyncro_variant_id) return setError(
        `"${item.description.trim()}" is not linked to a Shopify product. Search and select it from the dropdown, or create it in Shopify first then search here.`
      );
    }

    setSubmitting(true);
    try {
      let resolvedSupplierId: number;

      if (isNewSupplier) {
        const created = await onCreateSupplier({
          name: newSupplier.name.trim(),
          contact_name: newSupplier.contact_name.trim() || undefined,
          contact_email: newSupplier.contact_email.trim() || undefined,
          contact_phone: newSupplier.contact_phone.trim() || undefined,
          moq: newSupplier.moq.trim() ? Number(newSupplier.moq) : undefined,
          lead_time_days: newSupplier.lead_time_days.trim() ? Number(newSupplier.lead_time_days) : undefined,
        });
        resolvedSupplierId = created.id;
      } else {
        resolvedSupplierId = parseInt(supplierId, 10);
      }

      await onCreatePo({
        supplier_id: resolvedSupplierId,
        expected_delivery_date: expectedDate || undefined,
        notes: notes.trim() || undefined,
        line_items: lineItems.map((item) => ({
          description: (item.product_title ?? item.description).trim(),
          quantity_ordered: parseInt(item.quantity_ordered, 10),
          unit_cost_cents: item.unit_cost_cents
            ? Math.round(parseFloat(item.unit_cost_cents) * 100)
            : undefined,
          lasyncro_variant_id: item.lasyncro_variant_id?.trim() || null,
        })),
      });

      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Failed to create purchase order.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (submitting) return;
    setSupplierId('');
    setNewSupplier({ name: '', contact_name: '', contact_email: '', contact_phone: '', moq: '', lead_time_days: '' });
    setExpectedDate('');
    setNotes('');
    setLineItems([{ key: 0, description: '', quantity_ordered: '', unit_cost_cents: '' }]);
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="md">
      <DialogTitle>New Purchase Order</DialogTitle>
      <DialogContent>
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
                          unit_cost_cents: v.unit_cost ? String(v.unit_cost) : i.unit_cost_cents,
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
                              unit_cost_cents: v.unit_cost ? String(v.unit_cost) : i.unit_cost_cents,
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
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={submitting}>Cancel</Button>
        <Button variant="contained" onClick={() => void handleSubmit()} disabled={submitting}>
          {submitting ? 'Creating...' : 'Create PO'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─────────────────────────────────────────────
// SEND PO MODAL (Gap 2 — sourcing-recommendation-playbook.md §9.2)
// Preview PO before sending. Status only transitions after merchant confirms.
// Two channels: email (mailto) and copy as message (clipboard).
// ─────────────────────────────────────────────
function SendPoModal({
  po, lineItems, onClose,
}: {
  po: PurchaseOrder;
  lineItems: PoLineItem[];
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);

  const buildPoText = () => {
    const eta = po.expected_delivery_date
      ? new Date(po.expected_delivery_date).toLocaleDateString() : 'TBD';
    const lines = lineItems.map((i) =>
      `  - ${i.product_title ?? i.description}${i.sku ? ` (${i.sku})` : ''}: ${i.quantity_ordered} units`
    ).join('\n');
    return [
      `Purchase Order — ${po.supplier_name}`, '',
      'Items:', lines, '',
      `Expected delivery: ${eta}`,
      po.notes ? `Notes: ${po.notes}` : null,
      '', 'Sent via LaSyncro',
    ].filter((l) => l !== null).join('\n');
  };

  const handleCopy = async () => {
    setCopying(true);
    try {
      await navigator.clipboard.writeText(buildPoText());
      setCopied(true);
      // Close after flash so merchant can go paste it
      setTimeout(() => { setCopied(false); onClose(); }, 1500);
    } finally { setCopying(false); }
  };

  return (
    <EntityDetailModal
      entityId={po.id}
      onClose={onClose}
      title="Copy and send to supplier"
      subtitle={po.supplier_name}
      maxWidth="md"
      footerActions={
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Box component="button" onClick={() => void handleCopy()} disabled={copying}
            sx={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600,
              color: copied ? 'var(--confirm-ink)' : 'var(--accent-ink)',
              bgcolor: copied ? 'var(--confirm-ghost)' : copying ? 'var(--bg-3)' : 'var(--accent)',
              border: copied ? '1px solid var(--confirm-border)' : 'none',
              borderRadius: '6px', px: 1.5, py: 0.875,
              cursor: copying ? 'wait' : 'pointer',
              transition: 'all 0.2s',
              '&:hover': { opacity: copying ? 1 : 0.88 } }}>
            {copied ? 'Copied ✓' : copying ? 'Copying…' : 'Copy order →'}
          </Box>
          <Box component="button" onClick={onClose} disabled={copying}
            sx={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 500, color: 'var(--ink-3)', bgcolor: 'transparent', border: '0.5px solid var(--rule)', borderRadius: '6px', px: 1.5, py: 0.875, cursor: 'pointer', '&:hover': { opacity: 0.75 } }}>
            Cancel
          </Box>
        </Box>
      }
    >
      <Box sx={{ p: 2.5 }}>
        <Box component="pre" sx={{ fontFamily: 'monospace', fontSize: 12.5, lineHeight: 1.7, color: 'var(--ink)', bgcolor: 'var(--bg-2)', border: '1px solid var(--rule)', borderRadius: '8px', p: '14px 16px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', m: 0 }}>
          {buildPoText()}
        </Box>
        <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
            Click <strong>Copy order →</strong> to copy this text, then paste it into your email, WhatsApp, WeChat, or any app you use to contact this supplier.
          </Typography>
          <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mt: 0.5 }}>
            Once you've sent it, come back and click <strong>Mark as sent</strong> on the PO card to update its status.
          </Typography>
        </Box>
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
type NodeState = 'pending' | 'active' | 'confirmed';

function PoProgressTrack({ status }: { status: PurchaseOrderStatus }) {
  const theme = useTheme();

  const nodeState = (
    activeStatuses: PurchaseOrderStatus[],
    confirmedStatuses: PurchaseOrderStatus[],
  ): NodeState => {
    if (confirmedStatuses.includes(status)) return 'confirmed';
    if (activeStatuses.includes(status)) return 'active';
    return 'pending';
  };

  const nodes: { label: string; icon: React.ReactNode; state: NodeState }[] = [
    {
      label: 'Created',
      icon: <Plus size={16} />,
      state: 'confirmed',
    },
    {
      label: 'On the Way',
      icon: <Truck size={16} />,
      state: nodeState(
        ['ordered', 'confirmed', 'in_production'],
        ['shipped', 'partially_received', 'received'],
      ),
    },
    {
      label: 'Arrived',
      icon: <Package size={16} />,
      state: nodeState(
        ['shipped', 'partially_received'],
        ['received'],
      ),
    },
  ];

  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 2 }}>
      {nodes.map((node, i) => (
        <Box key={i} sx={{ display: 'flex', alignItems: 'center', flex: i < nodes.length - 1 ? 1 : 'none' }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 72 }}>
            <Box sx={{
              width: 40, height: 40, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: node.state === 'confirmed'
                    ? theme.palette.success.main
                    : node.state === 'active'
                      ? 'var(--accent)'
                      : 'var(--bg-3)',
                  color: node.state === 'pending' ? 'var(--ink-3)' : '#fff',
              ...(node.state === 'active' && {
                '@keyframes poNodePulse': {
                  '0%':   { boxShadow: '0 0 0 0 rgba(255,107,43,0.55)' },
                  '70%':  { boxShadow: '0 0 0 10px rgba(255,107,43,0)' },
                  '100%': { boxShadow: '0 0 0 0 rgba(255,107,43,0)' },
                },
                animation: 'poNodePulse 1.3s ease-out infinite',
              }),
              transition: 'all 0.2s',
            }}>
              {node.state === 'confirmed' ? <CheckCircle size={18} /> : node.icon}
            </Box>
            <Typography variant="caption" sx={{
              mt: 0.5, fontWeight: 600, fontSize: 10, textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: node.state === 'pending' ? 'text.disabled'
                : node.state === 'active' ? 'var(--accent)'
                  : 'success.main',
            }}>
              {node.state === 'confirmed' ? '✓ ' : ''}{node.label}
            </Typography>
          </Box>
          {i < nodes.length - 1 && (
            <Box sx={{
              flex: 1, height: 2, mx: 0.5, mb: 3,
              bgcolor: node.state === 'confirmed'
                ? theme.palette.success.main
                : theme.palette.divider,
              transition: 'background-color 0.2s',
            }} />
          )}
        </Box>
      ))}
    </Box>
  );
}

function PoAccordion({
  po,
  onFetchLineItems,
  onUpdatePoStatus,
  onCreateReceiveJob,
}: {
  po: PurchaseOrder;
  onFetchLineItems: (poId: string) => Promise<PoLineItem[]>;
  onUpdatePoStatus: (poId: string, status: PurchaseOrderStatus, actualDeliveryDate?: string) => Promise<void>;
  /** Creates a receive job for this PO and navigates to the WMS receive session. */
  onCreateReceiveJob: (poId: string) => Promise<{ receive_job_id: string }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [lineItems, setLineItems] = useState<PoLineItem[] | null>(null);
  const [loadingItems, setLoadingItems] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // §Gap2: controls PO send preview modal — status only transitions after merchant confirms
  const [sendPreviewOpen, setSendPreviewOpen] = useState(false);
  const [loadingSend, setLoadingSend] = useState(false);

  // §Gap2: load line items if not yet fetched, then open preview modal
  const handleOpenSendPreview = async () => {
    if (!lineItems) {
      setLoadingSend(true);
      try {
        const items = await onFetchLineItems(po.id);
        setLineItems(items);
      } finally {
        setLoadingSend(false);
      }
    }
    setSendPreviewOpen(true);
  };

  const navigate = useNavigate();

  /**
   * RECEIVE VIA WMS
   * ---------------
   * Creates a receive job for this PO, then navigates to the WMS page
   * with the job ID as a query param. WmsPage reads receiveJobId and
   * auto-enters the receive session — no manual navigation needed.
   */
  const handleReceive = useCallback(async () => {
    try {
      const { receive_job_id } = await onCreateReceiveJob(po.id);
      navigate(`/wms?receiveJobId=${receive_job_id}`);
    } catch {
      setError('Failed to start receive session. Please try again.');
    }
  }, [onCreateReceiveJob, po.id, navigate]);

  const status = STATUS_CONFIG[po.status];
  const eta = po.expected_delivery_date
    ? new Date(po.expected_delivery_date).toLocaleDateString()
    : '—';

  const handleExpand = async () => {
    setExpanded((v) => !v);
    if (!lineItems && !loadingItems) {
      setLoadingItems(true);
      try {
        const items = await onFetchLineItems(po.id);
        setLineItems(items);
      } catch {
        setError('Failed to load line items.');
      } finally {
        setLoadingItems(false);
      }
    }
  };

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

  return (
    <Accordion
      expanded={expanded}
      onChange={() => void handleExpand()}
      variant="outlined"
      sx={{ mb: 1.5, borderRadius: '8px !important', '&:before': { display: 'none' } }}
    >
      <AccordionSummary expandIcon={<ChevronDown size={16} />}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%', pr: 1 }}>
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <Typography variant="body2" fontWeight={700}>{po.supplier_name}</Typography>
              <Chip label={status.label} size="small" color={status.color} />
            </Box>
            <Box sx={{ display: 'flex', gap: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Clock size={12} />
                  <Typography variant="caption" color="text.secondary">ETA: {eta}</Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Package size={12} />
                  <Typography variant="caption" color="text.secondary">
                    {po.total_units_ordered} units · {po.line_items_count} lines
                  </Typography>
                </Box>
                {po.first_line_description && (
                  <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                    {po.first_line_description}{Number(po.line_items_count) > 1 ? ` +${Number(po.line_items_count) - 1} more` : ''}
                  </Typography>
                )}
            </Box>
          </Box>
        </Box>
      </AccordionSummary>

      <AccordionDetails sx={{ pt: 0 }}>
        <Divider sx={{ mb: 2 }} />
        <PoProgressTrack status={po.status} />
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {loadingItems && <ModuleLoadingSkeleton rows={1} height={20} />}

        {lineItems && (
          <TableContainer sx={{ mb: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Product</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11 }} align="right">Ordered</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11 }} align="right">Received</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {lineItems.map((item) => (
                  <TableRow key={item.id} hover>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {item.image_url ? (
                          <Box component="img" src={item.image_url} alt="" sx={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 0.5, flexShrink: 0 }} />
                        ) : (
                          <Box sx={{ width: 32, height: 32, borderRadius: 0.5, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Package size={14} style={{ opacity: 0.4 }} />
                          </Box>
                        )}
                        <Box>
                          <Typography variant="body2" fontWeight={600}>{item.product_title ?? item.description}</Typography>
                          {item.sku && <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>{item.sku}</Typography>}
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell align="right" sx={{ fontSize: 12 }}>{item.quantity_ordered}</TableCell>
                    <TableCell align="right" sx={{ fontSize: 12, fontWeight: item.quantity_received > 0 ? 700 : 400 }}>
                      {item.quantity_received}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {OPEN_STATUSES.includes(po.status) && (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {/* Draft: copy PO content, then manually confirm sent */}
            {po.status === 'draft' && (
              <>
                {/* Tier 1 — opens copy preview */}
                <Box component="button" onClick={() => void handleOpenSendPreview()} disabled={updatingStatus || loadingSend}
                  sx={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, color: 'var(--accent-ink)', bgcolor: updatingStatus || loadingSend ? 'var(--bg-3)' : 'var(--accent)', border: 'none', borderRadius: '6px', px: 1.25, py: 0.75, cursor: updatingStatus || loadingSend ? 'wait' : 'pointer', '&:hover': { opacity: 0.88 } }}>
                  {loadingSend ? 'Loading…' : 'Prepare to send →'}
                </Box>
                {/* Tier 2 — merchant confirms after actually sending it */}
                <Box component="button" onClick={() => void handleStatusUpdate('ordered')} disabled={updatingStatus}
                  sx={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: '0.5px solid var(--accent)', borderRadius: '6px', px: 1.25, py: 0.75, cursor: updatingStatus ? 'wait' : 'pointer', '&:hover': { opacity: 0.75 } }}>
                  Mark as sent
                </Box>
              </>
            )}
            {/* On the way → mark as arrived at dock */}
            {(po.status === 'ordered' || po.status === 'confirmed' || po.status === 'in_production') && (
              <Button size="small" variant="outlined" color="success" disabled={updatingStatus}
                onClick={() => void handleStatusUpdate('shipped')}>
                Mark as arrived
              </Button>
            )}
            {/* Arrived → start receive session in WMS */}
            {(po.status === 'shipped' || po.status === 'partially_received') && (
              <Button
                size="small"
                variant="contained"
                disabled={updatingStatus}
                startIcon={<CheckCircle size={14} />}
                onClick={() => void handleReceive()}
                sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}
              >
                Receive via WMS
              </Button>
            )}
            <Button size="small" variant="outlined" color="error" disabled={updatingStatus}
              startIcon={<XCircle size={14} />}
              onClick={() => void handleStatusUpdate('cancelled')}>Cancel PO</Button>
          </Box>
        )}

        {po.notes && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
            Notes: {po.notes}
          </Typography>
        )}

        {/* §Gap2: PO send preview modal — copy-only, no status transition inside */}
        {sendPreviewOpen && lineItems && (
          <SendPoModal
            po={po}
            lineItems={lineItems}
            onClose={() => setSendPreviewOpen(false)}
          />
        )}
      </AccordionDetails>
    </Accordion>
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
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
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
          sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}>
          {mode === 'add' ? 'Add supplier' : 'Save changes'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─────────────────────────────────────────────
// SUPPLIER ACCORDION
// ─────────────────────────────────────────────
function SupplierAccordion({ supplier, onEdit, onDelete }: {
  supplier: Supplier;
  onEdit: (s: Supplier) => void;
  onDelete: (s: Supplier) => void;
}) {
  return (
    <Accordion
      variant="outlined"
      sx={{ mb: 1, borderRadius: '8px !important', '&:before': { display: 'none' } }}
    >
      <AccordionSummary expandIcon={<ChevronDown size={16} />}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%', pr: 1 }}>
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" fontWeight={700}>{supplier.name}</Typography>
              {!supplier.active && <Chip label="Inactive" size="small" />}
              {Number(supplier.open_po_count) > 0 && (
                <Chip
                  label={`${supplier.open_po_count} open PO${Number(supplier.open_po_count) > 1 ? 's' : ''}`}
                  size="small" color="primary"
                />
              )}
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <RatingBadge label="On-time" value={supplier.on_time_rate} />
            <RatingBadge label="Fill" value={supplier.fill_rate} />
          </Box>
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>
        <Divider sx={{ mb: 1.5 }} />
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {supplier.contact_name && (
            <Typography variant="caption" color="text.secondary">Contact: {supplier.contact_name}</Typography>
          )}
          {supplier.contact_email && (
            <Typography variant="caption" color="text.secondary">Email: {supplier.contact_email}</Typography>
          )}
          {supplier.contact_phone && (
            <Typography variant="caption" color="text.secondary">Phone: {supplier.contact_phone}</Typography>
          )}
          <Typography variant="caption" color="text.secondary">Received POs: {supplier.total_pos}</Typography>
          {supplier.defect_rate !== null && (
            <Typography variant="caption" color="text.secondary">Defect rate: {supplier.defect_rate}%</Typography>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="caption" color="text.secondary">
              MOQ: {supplier.moq != null ? `${supplier.moq} units` : '—'}
            </Typography>
            {supplier.moq == null && (
              <Box component="span" onClick={() => onEdit(supplier)}
                sx={{ fontSize: 11, color: 'var(--accent)', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}>
                Set minimum order →
              </Box>
            )}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Lead time: {supplier.lead_time_days != null ? `${supplier.lead_time_days} days` : '—'}
            </Typography>
            {supplier.lead_time_days == null && (
              <Box component="span" onClick={() => onEdit(supplier)}
                sx={{ fontSize: 11, color: 'var(--accent)', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}>
                Set delivery time →
              </Box>
            )}
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
          <Button size="small" variant="outlined" onClick={() => onEdit(supplier)}>Edit</Button>
          <Button size="small" variant="outlined" color="error" onClick={() => onDelete(supplier)}>Delete</Button>
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}

// ─────────────────────────────────────────────
// MAIN MODULE
// ─────────────────────────────────────────────

function PurchasingPosView({
  data, isLoading, isError, onRefresh,
  onFetchLineItems, onUpdatePoStatus, onCreateSupplier, onCreatePo,
  onCreateReceiveJob, onSearchVariants, autoOpenCreatePo = false, prefilledLineItem,
  spotlights,
}: SuppliersPortalPageProps) {
  const [createPoOpen, setCreatePoOpen] = useState(autoOpenCreatePo);
  const [showClosed, setShowClosed] = useState(false);

  const allPos = data?.purchase_orders ?? [];
  const suppliers = data?.suppliers ?? [];
  const openPos = allPos.filter((po) => OPEN_STATUSES.includes(po.status));
  const closedPos = allPos.filter((po) => !OPEN_STATUSES.includes(po.status));

  const handlePoCreated = () => {
    setCreatePoOpen(false);
    onRefresh();
  };

  return (
    <Box sx={{ p: 2, maxWidth: 700, mx: 'auto' }}>

      {/* HEADER */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2 }}>
            Open POs
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Purchase orders and ETAs.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Plus size={16} />}
          onClick={() => setCreatePoOpen(true)}
          sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}
        >
          New PO
        </Button>
      </Box>

      {isLoading && <ModuleLoadingSkeleton />}

      {isError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Failed to load supplier data. Please refresh.
        </Alert>
      )}

      {!isLoading && !isError && (
        <>
          {/* OPEN POs */}
          <Box sx={{ mb: 4 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <Truck size={18} />
              <Typography variant="subtitle1" fontWeight={700}>Open Purchase Orders</Typography>
              <Chip label={openPos.length} size="small" color={openPos.length > 0 ? 'primary' : 'default'} />
            </Box>
            {/* §Gap2 spotlight — fires once when a draft PO exists; nudges merchant to use "Prepare to send →" */}
            {openPos.some((po) => po.status === 'draft') && spotlights && !spotlights.poSendFlow.isDismissed && (
              <Box sx={{ mb: 2 }}>
                <SpotlightCoachMark
                  title="Ready to order? Copy and send to your supplier"
                   body={'Open any draft PO, click "Prepare to send \u2192" to copy the order details, then paste into email, WhatsApp, or however you contact this supplier. Once sent, click "Mark as sent" to update the status.'}
                  isDismissed={spotlights.poSendFlow.isDismissed}
                  onDismiss={spotlights.poSendFlow.dismiss}
                  step={1}
                  totalSteps={1}
                />
              </Box>
            )}
            {openPos.length === 0 ? (
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
            ) : (
              openPos.map((po) => (
                <PoAccordion
                  key={po.id}
                  po={po}
                  onFetchLineItems={onFetchLineItems}
                  onUpdatePoStatus={onUpdatePoStatus}
                  onCreateReceiveJob={onCreateReceiveJob}
                />
              ))
            )}
          </Box>

          {/* CLOSED POs */}
          {closedPos.length > 0 && (
            <Box sx={{ mb: 4 }}>
              <Box
                sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, cursor: 'pointer' }}
                onClick={() => setShowClosed((v) => !v)}
              >
                <Typography variant="subtitle2" color="text.secondary">
                  {closedPos.length} closed / cancelled PO{closedPos.length > 1 ? 's' : ''}
                </Typography>
                <ChevronDown
                  size={14}
                  style={{ transform: showClosed ? 'rotate(180deg)' : 'none', transition: '0.2s' }}
                />
              </Box>
              {showClosed && closedPos.map((po) => (
                <PoAccordion
                  key={po.id}
                  po={po}
                  onFetchLineItems={onFetchLineItems}
                  onUpdatePoStatus={onUpdatePoStatus}
                  onCreateReceiveJob={onCreateReceiveJob}
                />
              ))}
            </Box>
          )}
          </>
      )}

      {/* CREATE PO DIALOG */}
      <CreatePoDialog
        open={createPoOpen}
        suppliers={suppliers}
        prefilledLineItem={prefilledLineItem}
        onClose={handlePoCreated}
        onCreateSupplier={onCreateSupplier}
        onCreatePo={onCreatePo}
        onSearchVariants={onSearchVariants}
      />
    </Box>
  );
}

function PurchasingSuppliersView({
  data, isLoading, isError, onUpdateSupplier, onCreateSupplier, onDeleteSupplier,
}: SuppliersPortalPageProps) {
  const [supplierFormOpen, setSupplierFormOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const suppliers = data?.suppliers ?? [];

  return (
    <Box sx={{ p: 2, maxWidth: 700, mx: 'auto' }}>

      {isLoading && <ModuleLoadingSkeleton />}

      {isError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Failed to load supplier data. Please refresh.
        </Alert>
      )}

      {!isLoading && !isError && (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb:2 }}>
            <Star size={18} />
            <Typography variant="subtitle1" fontWeight={700}>Suppliers</Typography>
            <Chip label={suppliers.length} size="small" />
            <Box sx={{ flex: 1 }} />
            <Button size="small" startIcon={<Plus size={16} />} variant="contained"
              onClick={() => { setEditingSupplier(null); setSupplierFormOpen(true); }}
              sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}>
              Add supplier
            </Button>
          </Box>

          {suppliers.length === 0 ? (
            <Paper variant="outlined" sx={{ textAlign: 'center', py: 6, borderRadius: 2, borderStyle: 'dashed' }}>
              <Star size={36} style={{ opacity: 0.3 }} />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                No suppliers added yet. Create a PO to add your first supplier.
              </Typography>
            </Paper>
          ) : (
            suppliers.map((s) => (
              <SupplierAccordion
                key={s.id}
                supplier={s}
                onEdit={(sup) => { setEditingSupplier(sup); setSupplierFormOpen(true); }}
                onDelete={async (sup) => {
                  if (window.confirm(`Remove ${sup.name}? Past purchase orders are kept; the supplier is hidden from new POs.`)) {
                    await onDeleteSupplier(sup.id);
                  }
                }}
              />
            ))
          )}
        </Box>
      )}

      <SupplierFormDialog
        open={supplierFormOpen}
        mode={editingSupplier ? 'edit' : 'add'}
        initial={editingSupplier ?? undefined}
        onClose={() => { setSupplierFormOpen(false); setEditingSupplier(null); }}
        onSubmit={async (input) => {
          if (editingSupplier) await onUpdateSupplier(editingSupplier.id, input);
          else await onCreateSupplier(input);
        }}
      />
    </Box>
  );
};

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

function PurchasingSourcingView({
  data,
  onCreatePo,
  onCreateSupplier,
  onSearchVariants,
  onFetchSourcingRecommendations,
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
  const triggerVariantId = searchParams.get('variantId');
  // §8: needed qty from alert deep-link — used for "Add to queue" pre-fill
  const neededQty = Number(searchParams.get('needed') ?? 1) || 1;

  const [activeVariantId, setActiveVariantId] = useState<string | null>(triggerVariantId);
  const [recommendations, setRecommendations] = useState<SourcingRecommendation[]>([]);
  const [isLoadingRecs, setIsLoadingRecs] = useState(false);

  const [preferences, setPreferences] = useState<PreferenceRow[]>([]);
  const [isLoadingPrefs, setIsLoadingPrefs] = useState(false);

  // §8 reorder accumulator state
  const [reorderRequests, setReorderRequests] = useState<SupplierAccumulation[]>([]);
  const [convertingSupplierIds, setConvertingSupplierIds] = useState<Set<number>>(new Set());

  const [createPoOpen, setCreatePoOpen] = useState(false);
  const [poVariantId, setPoVariantId] = useState<string | undefined>(undefined);
  const [poSupplierId, setPoSupplierId] = useState<number | undefined>(undefined);

  const [assignTarget, setAssignTarget] = useState<AssignSupplierTarget | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  // §8: per-supplier queue button state — 'idle' | 'adding' | 'added'
  const [queueButtonState, setQueueButtonState] = useState<Record<number, 'idle' | 'adding' | 'added'>>({});

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
      await onCreateReorderRequest({ lasyncro_variant_id: variantId, supplier_id: supplierId, qty_requested: neededQty, source: triggerVariantId ? 'alert' : 'manual' });
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
  const handleConvert = async (supplierId: number) => {
    setConvertingSupplierIds((prev) => new Set(prev).add(supplierId));
    try {
      // onConvertReorderRequests sets lastConvertedPoId at page level
      // before refetch so banner survives the re-render
      await onConvertReorderRequests(supplierId);
      const updated = await onFetchReorderRequests();
      setReorderRequests(updated);
    } finally {
      setConvertingSupplierIds((prev) => { const s = new Set(prev); s.delete(supplierId); return s; });
    }
  };

  useEffect(() => {
    if (!activeVariantId) return;
    setIsLoadingRecs(true);
    onFetchSourcingRecommendations(activeVariantId)
      .then(setRecommendations)
      .finally(() => setIsLoadingRecs(false));
  }, [activeVariantId, onFetchSourcingRecommendations]);

  const handleCreatePoFromRec = (variantId: string, supplierId: number) => {
    setPoVariantId(variantId);
    setPoSupplierId(supplierId);
    setCreatePoOpen(true);
  };

  const handleAssignOpen = (v: typeof neverOrdered[0]) => {
    setAssignTarget({ lasyncro_variant_id: v.lasyncro_variant_id, title: v.title, sku: v.sku, product_id: v.product_id, product_type: v.product_type });
    setAssignOpen(true);
  };

  const handleAssignSave = async (input: { supplier_id: number; scope_type: string; scope_id: string; priority: number; note?: string }) => {
    await onCreatePreference(input);
    const updated = await onFetchPreferences();
    setPreferences(updated);
  };

  const handleDeletePreference = async (id: string) => {
    await onDeletePreference(id);
    setPreferences((prev) => prev.filter((p) => p.id !== id));
  };

  const goodMatches = recommendations.filter(r => !r.exceeds_moq);
  const exceedsMoqMatches = recommendations.filter(r => r.exceeds_moq);

  const prefsByScope = {
    variant:      preferences.filter(p => p.scope_type === 'variant'),
    product:      preferences.filter(p => p.scope_type === 'product'),
    product_type: preferences.filter(p => p.scope_type === 'product_type'),
  };
  const scopeLabels: Record<string, string> = { variant: 'Variant', product: 'Product', product_type: 'Product Type' };

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2.25, alignItems: 'start' }}>

        {/* DECISION CARD */}
        <Box sx={{ flex: '1 0 300px', minWidth: 0, bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', overflow: 'hidden' }}>
          <Box sx={{ p: '18px 20px', borderBottom: '1px solid var(--rule)' }}>
            <Typography sx={{ fontSize: 16, fontWeight: 500, color: 'var(--ink)' }}>Sourcing recommendations</Typography>
            <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)', mt: 0.25 }}>
              {activeVariantId ? 'Ranked by supplier reliability — on-time rate, fill rate, defect rate' : 'Select a stockout alert to see ranked supplier options'}
            </Typography>
          </Box>

          {/* §7.6 ISS-SR-06: no variantId → show preferences + never-ordered instead of empty state */}
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

          {activeVariantId && !isLoadingRecs && recommendations.length === 0 && (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }}>No supplier history for this product yet.</Typography>
            </Box>
          )}

          {/* Spotlight 2 — fires first time recommendations load from an alert */}
          {activeVariantId && !isLoadingRecs && goodMatches.length > 0 && spotlights && !spotlights.alertTriggered.isDismissed && (
            <Box sx={{ px: 2.5, pt: 1.5, borderTop: '1px solid var(--rule)' }}>
              <SpotlightCoachMark
                title="Your best supplier, ranked automatically"
                body="Rankings are based on delivery speed, order accuracy, and quality from your real orders. Order now, or add to queue to combine with other products before sending."
                isDismissed={spotlights.alertTriggered.isDismissed}
                onDismiss={spotlights.alertTriggered.dismiss}
                step={2}
                totalSteps={3}
              />
            </Box>
          )}

          {goodMatches.map((rec) => (
            <Box key={rec.id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2.5, py: 1.75, borderTop: '1px solid var(--rule)' }}>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>{rec.name}</Typography>
                  {rec.is_preferred && (
                    <Chip label="★ Preferred" size="small"
                      sx={{ fontSize: 10, height: 18, bgcolor: 'var(--accent-ghost)', color: 'var(--accent)' }} />
                  )}
                </Box>
                <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>
                  {(() => {
                    const parts = [
                      rec.on_time_rate != null && `On-time ${rec.on_time_rate}%`,
                      rec.fill_rate != null && `Fill ${rec.fill_rate}%`,
                      rec.lead_time_days != null && `Lead ${rec.lead_time_days}d`,
                    ].filter(Boolean);
                    return parts.length > 0 ? parts.join(' · ') : 'No order history yet';
                  })()}
                </Typography>
              </Box>
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
            </Box>
          ))}

          {exceedsMoqMatches.map((rec) => (
            <Box key={rec.id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2.5, py: 1.75, borderTop: '1px solid var(--rule)', opacity: 0.7 }}>
              <Box>
                <Typography sx={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>{rec.name}</Typography>
                <Typography sx={{ fontSize: 12, fontWeight: 300, color: '#C62828' }}>Exceeds MOQ ({rec.moq} units)</Typography>
              </Box>
              <Box component="button" onClick={() => activeVariantId && handleCreatePoFromRec(activeVariantId, rec.id)}
                sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: '0.5px solid var(--accent)', borderRadius: '6px', px: 1.25, py: 0.75, cursor: 'pointer', '&:hover': { opacity: 0.75 } }}>
                Create PO anyway →
              </Box>
            </Box>
          ))}

          {/* §8 post-convert confirmation — state lives at page level to survive refetch */}
          {lastConvertedPoId && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2.5, py: 1.5, borderTop: '1px solid var(--rule)', bgcolor: 'var(--accent-ghost)' }}>
              <Typography sx={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500 }}>
                Draft PO created — check Open POs to review and send.
              </Typography>
              <Box component="button" onClick={() => onDismissConvertedPo?.()}
                sx={{ display: 'inline-flex', alignItems: 'center', fontSize: 11, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: '0.5px solid var(--accent)', borderRadius: '6px', px: 1, py: 0.5, cursor: 'pointer', '&:hover': { opacity: 0.75 } }}>
                Dismiss
              </Box>
            </Box>
          )}

          {/* §8 Pending Reorders — always visible when accumulator has items */}
          {reorderRequests.length > 0 && (
            <Box sx={{ borderTop: '1px solid var(--rule)' }}>
              <Box sx={{ px: 2.5, py: 1.5, bgcolor: 'var(--bg-2)' }}>
                <Typography sx={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                  Pending reorders · {reorderRequests.length} supplier{reorderRequests.length > 1 ? 's' : ''}
                </Typography>
              </Box>
              {/* Spotlight 3 — fires first time accumulator has items */}
              {spotlights && !spotlights.accumulator.isDismissed && (
                <Box sx={{ px: 2.5, pt: 1.5 }}>
                  <SpotlightCoachMark
                    title="Building up your order before sending"
                    body="Products queue here by supplier. Once you've added enough to meet their minimum order, Create PO lights up. You can always send early if you need to."
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
                      {group.moq_met ? (
                        <Box component="button" onClick={() => !converting && void handleConvert(group.supplier_id)}
                          sx={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, color: 'var(--accent-ink)', bgcolor: 'var(--accent)', border: 'none', borderRadius: '6px', px: 1.25, py: 0.75, cursor: converting ? 'wait' : 'pointer', '&:hover': { opacity: 0.88 }, flexShrink: 0 }}>
                          {converting ? 'Creating…' : 'Create PO →'}
                        </Box>
                      ) : (
                        <Box component="button" onClick={() => !converting && void handleConvert(group.supplier_id)}
                          sx={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: '0.5px solid var(--accent)', borderRadius: '6px', px: 1.25, py: 0.75, cursor: converting ? 'wait' : 'pointer', '&:hover': { opacity: 0.75 }, flexShrink: 0 }}>
                          {converting ? 'Creating…' : 'Create PO anyway →'}
                        </Box>
                      )}
                    </Box>
                    {/* MOQ progress bar — only when supplier has a set MOQ */}
                    {group.moq !== null && (
                      <Box>
                        <Box sx={{ height: 4, borderRadius: 2, bgcolor: 'var(--bg-3)', overflow: 'hidden', mb: 0.5 }}>
                          <Box sx={{ height: '100%', width: `${moqPct}%`, bgcolor: group.moq_met ? 'var(--accent)' : 'var(--ink-3)', borderRadius: 2, transition: 'width 0.3s' }} />
                        </Box>
                        <Typography sx={{ fontSize: 10, color: group.moq_met ? 'var(--accent)' : 'var(--ink-4)' }}>
                          {group.total_qty} / {group.moq} units{group.moq_met ? ' — MOQ met' : ' — MOQ not met'}
                        </Typography>
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Box>
          )}

          {/* §6a Branch B: never-ordered group — always visible */}
          {neverOrderedCount > 0 && (
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
                    sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: '0.5px solid var(--accent)', borderRadius: '6px', px: 1.25, py: 0.75, cursor: 'pointer', '&:hover': { opacity: 0.75 } }}>
                    Assign a supplier →
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </Box>

        {/* PULSE CARD — migrated to shared PulseCard, PULSE-01 */}
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

      <CreatePoDialog
        open={createPoOpen}
        suppliers={suppliers}
        onClose={() => setCreatePoOpen(false)}
        onCreateSupplier={onCreateSupplier}
        onCreatePo={onCreatePo}
        onSearchVariants={onSearchVariants}
        prefilledLineItem={poVariantId ? { description: '', quantity_ordered: 1, lasyncro_variant_id: poVariantId } : undefined}
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
  const prefilledLineItem = autoOpenCreatePo
    ? {
        description: searchParams.get('description') ?? searchParams.get('sku') ?? '',
        quantity_ordered: Number(searchParams.get('qty') ?? 0) || 0,
        lasyncro_variant_id: searchParams.get('variantId') ?? undefined,
      }
    : undefined;
  return (
    <ModuleErrorBoundary moduleName="suppliers-portal">
      <SuppliersPortalModuleFT2Inner {...props} autoOpenCreatePo={autoOpenCreatePo} prefilledLineItem={prefilledLineItem} />
    </ModuleErrorBoundary>
  );
}