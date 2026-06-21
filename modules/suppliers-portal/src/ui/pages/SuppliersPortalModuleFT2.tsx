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
import { ModuleErrorBoundary, ModuleLoadingSkeleton } from '@lasyncro/shared/ui';

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
  open_po_count: number;
};

export type CreateSupplierInput = {
  name: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
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

export type SuppliersPortalData = {
  purchase_orders: PurchaseOrder[];
  suppliers: Supplier[];
} | null;

export type SuppliersPortalPageProps = {
  data: SuppliersPortalData;
  isLoading: boolean;
  isError: boolean;
  onRefresh: () => void;
  onFetchLineItems: (poId: string) => Promise<PoLineItem[]>;
  onUpdatePoStatus: (poId: string, status: PurchaseOrderStatus, actualDeliveryDate?: string) => Promise<void>;
  onCreateSupplier: (input: CreateSupplierInput) => Promise<Supplier>;
  onCreatePo: (input: CreatePoInput) => Promise<void>;
  /** Creates a WMS receive job for a shipped PO. Navigates operator to receive session. */
  onCreateReceiveJob: (poId: string) => Promise<{ receive_job_id: string }>;
  onSearchVariants: (q: string) => Promise<VariantOption[]>;
  /** When true, auto-opens the Create PO dialog on mount (from demand module handoff) */
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
}: {
  open: boolean;
  suppliers: Supplier[];
  onClose: () => void;
  onCreateSupplier: (input: CreateSupplierInput) => Promise<Supplier>;
  onCreatePo: (input: CreatePoInput) => Promise<void>;
  onSearchVariants: (q: string) => Promise<VariantOption[]>;
  prefilledLineItem?: { description: string; quantity_ordered: number; lasyncro_variant_id?: string };
}) {
  const [supplierId, setSupplierId] = useState<string>('');
  const [newSupplier, setNewSupplier] = useState({ name: '', contact_name: '', contact_email: '', contact_phone: '' });
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
    setNewSupplier({ name: '', contact_name: '', contact_email: '', contact_phone: '' });
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
                  : theme.palette.action.disabledBackground,
              color: node.state === 'pending' ? theme.palette.text.disabled : '#fff',
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
            {/* Draft → mark as sent to supplier */}
            {po.status === 'draft' && (
              <Button size="small" variant="outlined" color="info" disabled={updatingStatus}
                onClick={() => void handleStatusUpdate('ordered')}>
                Mark as sent
              </Button>
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
      </AccordionDetails>
    </Accordion>
  );
}

// ─────────────────────────────────────────────
// SUPPLIER ACCORDION
// ─────────────────────────────────────────────

function SupplierAccordion({ supplier }: { supplier: Supplier }) {
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
          <Typography variant="caption" color="text.secondary">Lifetime POs: {supplier.total_pos}</Typography>
          {supplier.defect_rate !== null && (
            <Typography variant="caption" color="text.secondary">Defect rate: {supplier.defect_rate}%</Typography>
          )}
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}

// ─────────────────────────────────────────────
// MAIN MODULE
// ─────────────────────────────────────────────

function SuppliersPortalModuleFT2Inner({
  data,
  isLoading,
  isError,
  onRefresh,
  onFetchLineItems,
  onUpdatePoStatus,
  onCreateSupplier,
  onCreatePo,
  onCreateReceiveJob,
  onSearchVariants,
  autoOpenCreatePo = false,
  prefilledLineItem,
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
            Suppliers
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Purchase orders, ETAs, and supplier ratings.
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

          <Divider sx={{ mb: 3 }} />

          {/* SUPPLIERS LIST — bottom */}
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <Star size={18} />
              <Typography variant="subtitle1" fontWeight={700}>Suppliers</Typography>
              <Chip label={suppliers.length} size="small" />
            </Box>

            {suppliers.length === 0 ? (
              <Paper variant="outlined" sx={{ textAlign: 'center', py: 6, borderRadius: 2, borderStyle: 'dashed' }}>
                <Star size={36} style={{ opacity: 0.3 }} />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                  No suppliers added yet. Create a PO to add your first supplier.
                </Typography>
              </Paper>
            ) : (
              suppliers.map((s) => <SupplierAccordion key={s.id} supplier={s} />)
            )}
          </Box>
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