import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// modules/suppliers-portal/src/ui/pages/SuppliersPortalModuleFT2.tsx
import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Paper, Typography, Alert, Chip, useTheme, Divider, Accordion, AccordionSummary, AccordionDetails, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem, IconButton, } from '@mui/material';
import { Truck, Star, Clock, ChevronDown, Package, CheckCircle, XCircle, Plus, Trash2 } from 'lucide-react';
import { ModuleErrorBoundary, ModuleLoadingSkeleton, SpotlightCoachMark, EntityDetailModal, } from '@lasyncro/shared/ui';
const STATUS_CONFIG = {
    draft: { label: 'Draft', color: 'default' },
    ordered: { label: 'On the way', color: 'info' },
    confirmed: { label: 'On the way', color: 'info' },
    in_production: { label: 'On the way', color: 'info' },
    shipped: { label: 'Arrived', color: 'success' },
    partially_received: { label: 'Receiving', color: 'warning' },
    received: { label: 'Received', color: 'success' },
    cancelled: { label: 'Cancelled', color: 'error' },
};
const OPEN_STATUSES = [
    'draft', 'ordered', 'confirmed', 'in_production', 'shipped', 'partially_received'
];
const NEW_SUPPLIER_SENTINEL = '__new__';
function CreatePoDialog({ open, suppliers, onClose, onCreateSupplier, onCreatePo, onSearchVariants, prefilledLineItem, prefilledSupplierId, }) {
    const [supplierId, setSupplierId] = useState(prefilledSupplierId ? String(prefilledSupplierId) : '');
    const [newSupplier, setNewSupplier] = useState({ name: '', contact_name: '', contact_email: '', contact_phone: '', moq: '', lead_time_days: '' });
    const [expectedDate, setExpectedDate] = useState('');
    const [notes, setNotes] = useState('');
    const [lineItems, setLineItems] = useState([
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
    const [error, setError] = useState(null);
    const [variantOptions, setVariantOptions] = useState([]);
    const [variantSearch, setVariantSearch] = useState({});
    const [focusedOptionIndex, setFocusedOptionIndex] = useState(-1);
    // Ref for the dropdown container — used to auto-scroll focused option into view
    const dropdownRef = useRef(null);
    useEffect(() => {
        if (focusedOptionIndex < 0 || !dropdownRef.current)
            return;
        const el = dropdownRef.current.children[focusedOptionIndex];
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
    const removeLineItem = (key) => {
        setLineItems((prev) => prev.filter((i) => i.key !== key));
    };
    const updateLineItem = (key, field, value) => {
        setLineItems((prev) => prev.map((i) => (i.key === key ? { ...i, [field]: value } : i)));
    };
    const handleSubmit = async () => {
        setError(null);
        // Validate supplier
        if (!supplierId)
            return setError('Please select a supplier.');
        if (isNewSupplier && !newSupplier.name.trim())
            return setError('New supplier name is required.');
        // Validate line items
        for (const item of lineItems) {
            if (!item.description.trim())
                return setError('All line items need a description.');
            const qty = parseInt(item.quantity_ordered, 10);
            if (isNaN(qty) || qty < 1)
                return setError('All line items need a valid quantity (≥ 1).');
            if (!item.lasyncro_variant_id)
                return setError(`"${item.description.trim()}" is not linked to a Shopify product. Search and select it from the dropdown, or create it in Shopify first then search here.`);
        }
        setSubmitting(true);
        try {
            let resolvedSupplierId;
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
            }
            else {
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
        }
        catch (err) {
            setError(err?.response?.data?.error ?? 'Failed to create purchase order.');
        }
        finally {
            setSubmitting(false);
        }
    };
    const handleClose = () => {
        if (submitting)
            return;
        setSupplierId('');
        setNewSupplier({ name: '', contact_name: '', contact_email: '', contact_phone: '', moq: '', lead_time_days: '' });
        setExpectedDate('');
        setNotes('');
        setLineItems([{ key: 0, description: '', quantity_ordered: '', unit_cost_cents: '' }]);
        setError(null);
        onClose();
    };
    return (_jsxs(Dialog, { open: open, onClose: handleClose, fullWidth: true, maxWidth: "md", children: [_jsx(DialogTitle, { children: "New Purchase Order" }), _jsx(DialogContent, { children: _jsxs(Box, { sx: { display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }, children: [error && _jsx(Alert, { severity: "error", children: error }), _jsxs(TextField, { select: true, label: "Supplier", value: supplierId, onChange: (e) => setSupplierId(e.target.value), fullWidth: true, size: "small", children: [suppliers.filter((s) => s.active).map((s) => (_jsx(MenuItem, { value: String(s.id), children: s.name }, s.id))), _jsx(MenuItem, { value: NEW_SUPPLIER_SENTINEL, children: _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1 }, children: [_jsx(Plus, { size: 14 }), _jsx(Typography, { variant: "body2", children: "Add new supplier" })] }) })] }), isNewSupplier && (_jsxs(Box, { sx: { display: 'flex', flexDirection: 'column', gap: 1.5, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }, children: [_jsx(Typography, { variant: "caption", fontWeight: 700, color: "text.secondary", children: "NEW SUPPLIER" }), _jsx(TextField, { label: "Name *", size: "small", fullWidth: true, value: newSupplier.name, onChange: (e) => setNewSupplier((p) => ({ ...p, name: e.target.value })) }), _jsx(TextField, { label: "Contact name", size: "small", fullWidth: true, value: newSupplier.contact_name, onChange: (e) => setNewSupplier((p) => ({ ...p, contact_name: e.target.value })) }), _jsx(TextField, { label: "Email", size: "small", fullWidth: true, value: newSupplier.contact_email, onChange: (e) => setNewSupplier((p) => ({ ...p, contact_email: e.target.value })) }), _jsx(TextField, { label: "Phone", size: "small", fullWidth: true, value: newSupplier.contact_phone, onChange: (e) => setNewSupplier((p) => ({ ...p, contact_phone: e.target.value })) }), _jsx(TextField, { label: "Min order qty (MOQ)", type: "number", size: "small", fullWidth: true, value: newSupplier.moq, onChange: (e) => setNewSupplier((p) => ({ ...p, moq: e.target.value })), helperText: "Units this supplier requires per order. Leave blank for no minimum." }), _jsx(TextField, { label: "Lead time (days)", type: "number", size: "small", fullWidth: true, value: newSupplier.lead_time_days, onChange: (e) => setNewSupplier((p) => ({ ...p, lead_time_days: e.target.value })), helperText: "Days from PO sent to goods received. Used to compute the best reorder date." })] })), _jsx(TextField, { label: "Expected delivery date", type: "date", size: "small", fullWidth: true, value: expectedDate, onChange: (e) => setExpectedDate(e.target.value), InputLabelProps: { shrink: true } }), _jsxs(Box, { children: [_jsx(Typography, { variant: "caption", fontWeight: 700, color: "text.secondary", sx: { mb: 1, display: 'block' }, children: "LINE ITEMS" }), lineItems.map((item, idx) => (_jsxs(Box, { sx: { display: 'flex', gap: 1, mb: 1, alignItems: 'flex-start' }, children: [_jsx(Box, { sx: { flex: 3, position: 'relative' }, children: item.lasyncro_variant_id ? (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1, px: 1.5, height: 40, overflow: 'hidden' }, children: [item.image_url ? (_jsx(Box, { component: "img", src: item.image_url, alt: "", sx: { width: 32, height: 32, objectFit: 'cover', borderRadius: 0.5, flexShrink: 0 } })) : (_jsx(Box, { sx: { width: 32, height: 32, borderRadius: 0.5, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, children: _jsx(Package, { size: 14, style: { opacity: 0.4 } }) })), _jsxs(Box, { sx: { flex: 1, minWidth: 0 }, children: [_jsx(Typography, { variant: "body2", fontWeight: 600, noWrap: true, children: item.product_title ?? item.description }), item.sku && _jsx(Typography, { variant: "caption", color: "text.secondary", children: item.sku })] }), _jsx(IconButton, { size: "small", onClick: () => {
                                                            setLineItems((prev) => prev.map((i) => i.key === item.key ? { ...i, lasyncro_variant_id: null, description: '', product_title: null, image_url: null, sku: null } : i));
                                                            setVariantSearch((p) => ({ ...p, [item.key]: '' }));
                                                        }, sx: { flexShrink: 0 }, children: _jsx(XCircle, { size: 14 }) })] })) : (_jsxs(_Fragment, { children: [_jsx(TextField, { label: "Product / SKU", size: "small", fullWidth: true, autoComplete: "off", value: variantSearch[item.key] ?? item.description, error: (variantSearch[item.key]?.length ?? 0) > 0 && !item.lasyncro_variant_id && variantOptions.length === 0, helperText: (variantSearch[item.key]?.length ?? 0) > 0 && !item.lasyncro_variant_id && variantOptions.length === 0
                                                            ? (_jsxs("span", { children: ["Not linked to Shopify catalog \u2014", ' ', _jsx("a", { href: "https://admin.shopify.com/store/products/new", target: "_blank", rel: "noopener noreferrer", children: "create the product in Shopify first \u2192" }), _jsx("br", {}), "Then re-sync."] }))
                                                            : undefined, onKeyDown: (e) => {
                                                            if (!variantOptions.length)
                                                                return;
                                                            if (e.key === 'ArrowDown') {
                                                                e.preventDefault();
                                                                setFocusedOptionIndex((i) => Math.min(i + 1, variantOptions.length - 1));
                                                            }
                                                            else if (e.key === 'ArrowUp') {
                                                                e.preventDefault();
                                                                setFocusedOptionIndex((i) => Math.max(i - 1, 0));
                                                            }
                                                            else if (e.key === 'Enter' && focusedOptionIndex >= 0) {
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
                                                            }
                                                            else if (e.key === 'Escape') {
                                                                setVariantOptions([]);
                                                                setFocusedOptionIndex(-1);
                                                            }
                                                        }, onBlur: () => {
                                                            // Delay clear so click on dropdown option registers first
                                                            setTimeout(() => {
                                                                setVariantOptions([]);
                                                                setFocusedOptionIndex(-1);
                                                            }, 150);
                                                        }, onFocus: async () => {
                                                            if (!item.lasyncro_variant_id) {
                                                                const results = await onSearchVariants(variantSearch[item.key] ?? '');
                                                                setVariantOptions(results);
                                                            }
                                                        }, onChange: async (e) => {
                                                            setFocusedOptionIndex(-1);
                                                            const q = e.target.value;
                                                            setVariantSearch((p) => ({ ...p, [item.key]: q }));
                                                            updateLineItem(item.key, 'description', q);
                                                            setLineItems((prev) => prev.map((i) => i.key === item.key ? { ...i, lasyncro_variant_id: null } : i));
                                                            if (q.length >= 1) {
                                                                const results = await onSearchVariants(q);
                                                                setVariantOptions(results);
                                                            }
                                                            else {
                                                                setVariantOptions([]);
                                                            }
                                                        } }), variantOptions.length > 0 && !item.lasyncro_variant_id && (_jsx(Box, { ref: dropdownRef, onMouseDown: (e) => e.preventDefault(), sx: {
                                                            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                                                            bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider',
                                                            borderRadius: 1, boxShadow: 3, maxHeight: 200, overflowY: 'auto',
                                                        }, children: variantOptions.map((v, optIdx) => (_jsxs(Box, { onMouseDown: (e) => e.preventDefault(), sx: { px: 1.5, py: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 1, bgcolor: focusedOptionIndex === optIdx ? 'action.selected' : 'transparent', '&:hover': { bgcolor: focusedOptionIndex === optIdx ? 'action.selected' : 'action.hover' } }, onClick: () => {
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
                                                            }, children: [v.image_url ? (_jsx(Box, { component: "img", src: v.image_url, alt: "", sx: { width: 32, height: 32, objectFit: 'cover', borderRadius: 0.5, flexShrink: 0 } })) : (_jsx(Box, { sx: { width: 32, height: 32, borderRadius: 0.5, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, children: _jsx(Package, { size: 14, style: { opacity: 0.4 } }) })), _jsxs(Box, { children: [_jsx(Typography, { variant: "body2", fontWeight: 600, sx: { lineHeight: 1.3 }, children: v.product_title ?? v.title ?? 'Unknown product' }), v.sku && _jsx(Typography, { variant: "caption", color: "text.secondary", children: v.sku })] })] }, v.lasyncro_variant_id))) }))] })) }), _jsx(TextField, { label: "Qty *", size: "small", type: "number", autoComplete: "off", value: item.quantity_ordered, onChange: (e) => updateLineItem(item.key, 'quantity_ordered', e.target.value), inputProps: { min: 1 }, error: item.quantity_ordered !== '' && (isNaN(parseInt(item.quantity_ordered, 10)) || parseInt(item.quantity_ordered, 10) < 1), helperText: item.quantity_ordered !== '' && (isNaN(parseInt(item.quantity_ordered, 10)) || parseInt(item.quantity_ordered, 10) < 1) ? 'Enter a whole number ≥ 1' : undefined, sx: { flex: 1 } }), _jsx(TextField, { label: "Unit cost", size: "small", type: "text", autoComplete: "off", inputMode: "decimal", value: item.unit_cost_cents, onChange: (e) => {
                                                const raw = e.target.value;
                                                // Allow only positive numbers with up to 2 decimal places
                                                if (raw === '' || /^\d*\.?\d{0,2}$/.test(raw)) {
                                                    updateLineItem(item.key, 'unit_cost_cents', raw);
                                                }
                                            }, onBlur: (e) => {
                                                const val = parseFloat(e.target.value);
                                                if (!isNaN(val)) {
                                                    updateLineItem(item.key, 'unit_cost_cents', val.toFixed(2));
                                                }
                                            }, error: item.unit_cost_cents !== '' && isNaN(parseFloat(item.unit_cost_cents)), helperText: item.unit_cost_cents !== '' && isNaN(parseFloat(item.unit_cost_cents)) ? 'Enter a number (e.g. 12.99)' : undefined, inputProps: {}, InputProps: {
                                                startAdornment: (_jsx(Box, { component: "span", sx: { mr: 0.5, color: 'text.secondary', fontSize: 13 }, children: "$" })),
                                            } }), _jsx(IconButton, { size: "small", onClick: () => removeLineItem(item.key), disabled: lineItems.length === 1, sx: { mt: 0.5 }, children: _jsx(Trash2, { size: 14 }) })] }, item.key))), _jsx(Button, { size: "small", startIcon: _jsx(Plus, { size: 14 }), onClick: addLineItem, children: "Add line item" })] }), _jsx(TextField, { label: "Notes", size: "small", fullWidth: true, multiline: true, rows: 2, value: notes, onChange: (e) => setNotes(e.target.value), placeholder: "Any notes about this PO..." })] }) }), _jsxs(DialogActions, { children: [_jsx(Button, { onClick: handleClose, disabled: submitting, children: "Cancel" }), _jsx(Button, { variant: "contained", onClick: () => void handleSubmit(), disabled: submitting, children: submitting ? 'Creating...' : 'Create PO' })] })] }));
}
// ─────────────────────────────────────────────
// SEND PO MODAL (Gap 2 — sourcing-recommendation-playbook.md §9.2)
// Preview PO before sending. Status only transitions after merchant confirms.
// Two channels: email (mailto) and copy as message (clipboard).
// ─────────────────────────────────────────────
function SendPoModal({ po, lineItems, onClose, }) {
    const [copied, setCopied] = useState(false);
    const [copying, setCopying] = useState(false);
    const buildPoText = () => {
        const eta = po.expected_delivery_date
            ? new Date(po.expected_delivery_date).toLocaleDateString() : 'TBD';
        const lines = lineItems.map((i) => `  - ${i.product_title ?? i.description}${i.sku ? ` (${i.sku})` : ''}: ${i.quantity_ordered} units`).join('\n');
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
        }
        finally {
            setCopying(false);
        }
    };
    return (_jsx(EntityDetailModal, { entityId: po.id, onClose: onClose, title: "Copy and send to supplier", subtitle: po.supplier_name, maxWidth: "md", footerActions: _jsxs(Box, { sx: { display: 'flex', gap: 1, flexWrap: 'wrap' }, children: [_jsx(Box, { component: "button", onClick: () => void handleCopy(), disabled: copying, sx: { display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600,
                        color: copied ? 'var(--confirm-ink)' : 'var(--accent-ink)',
                        bgcolor: copied ? 'var(--confirm-ghost)' : copying ? 'var(--bg-3)' : 'var(--accent)',
                        border: copied ? '1px solid var(--confirm-border)' : 'none',
                        borderRadius: '6px', px: 1.5, py: 0.875,
                        cursor: copying ? 'wait' : 'pointer',
                        transition: 'all 0.2s',
                        '&:hover': { opacity: copying ? 1 : 0.88 } }, children: copied ? 'Copied ✓' : copying ? 'Copying…' : 'Copy order →' }), _jsx(Box, { component: "button", onClick: onClose, disabled: copying, sx: { display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 500, color: 'var(--ink-3)', bgcolor: 'transparent', border: '0.5px solid var(--rule)', borderRadius: '6px', px: 1.5, py: 0.875, cursor: 'pointer', '&:hover': { opacity: 0.75 } }, children: "Cancel" })] }), children: _jsxs(Box, { sx: { p: 2.5 }, children: [_jsx(Box, { component: "pre", sx: { fontFamily: 'monospace', fontSize: 12.5, lineHeight: 1.7, color: 'var(--ink)', bgcolor: 'var(--bg-2)', border: '1px solid var(--rule)', borderRadius: '8px', p: '14px 16px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', m: 0 }, children: buildPoText() }), _jsxs(Box, { sx: { mt: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }, children: [_jsxs(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)' }, children: ["Click ", _jsx("strong", { children: "Copy order \u2192" }), " to copy this text, then paste it into your email, WhatsApp, WeChat, or any app you use to contact this supplier."] }), _jsxs(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)', mt: 0.5 }, children: ["Once you've sent it, come back and click ", _jsx("strong", { children: "Mark as sent" }), " on the PO card to update its status."] })] })] }) }));
}
// ─────────────────────────────────────────────
// PO ACCORDION
// ─────────────────────────────────────────────
function RatingBadge({ label, value }) {
    if (value === null)
        return null;
    const color = value >= 90 ? 'success' : value >= 70 ? 'warning' : 'error';
    return (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.5 }, children: [_jsx(Typography, { variant: "caption", color: "text.secondary", children: label }), _jsx(Chip, { label: `${Math.round(value)}%`, size: "small", color: color })] }));
}
function ReceiveShipmentDialog({ open, lineItems, onClose, onConfirm, }) {
    const [quantities, setQuantities] = useState({});
    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const handleConfirm = async () => {
        setError(null);
        const items = (lineItems ?? [])
            .map((item) => ({
            line_item_id: item.id,
            quantity_received: parseInt(quantities[item.id] ?? '0', 10),
        }))
            .filter((item) => item.quantity_received > 0);
        if (items.length === 0)
            return setError('Enter at least one received quantity.');
        setSubmitting(true);
        try {
            await onConfirm(items, notes);
            onClose();
        }
        catch {
            setError('Failed to record receipt.');
        }
        finally {
            setSubmitting(false);
        }
    };
    return (_jsxs(Dialog, { open: open, onClose: onClose, fullWidth: true, maxWidth: "sm", children: [_jsx(DialogTitle, { children: "Receive Shipment" }), _jsx(DialogContent, { children: _jsxs(Box, { sx: { display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }, children: [error && _jsx(Alert, { severity: "error", children: error }), !lineItems && _jsx(ModuleLoadingSkeleton, { rows: 1, height: 20 }), lineItems && lineItems.map((item) => {
                            const remaining = item.quantity_ordered - item.quantity_received;
                            return (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 2 }, children: [_jsxs(Box, { sx: { flex: 3 }, children: [_jsx(Typography, { variant: "body2", fontWeight: 600, children: item.description }), _jsxs(Typography, { variant: "caption", color: "text.secondary", children: ["Ordered: ", item.quantity_ordered, " \u00B7 Already received: ", item.quantity_received, " \u00B7 Remaining: ", remaining] })] }), _jsx(TextField, { label: "Qty received", size: "small", type: "number", value: quantities[item.id] ?? '', onChange: (e) => setQuantities((p) => ({ ...p, [item.id]: e.target.value })), inputProps: { min: 0, max: remaining }, sx: { flex: 1 }, disabled: remaining === 0 })] }, item.id));
                        }), _jsx(TextField, { label: "Notes", size: "small", fullWidth: true, multiline: true, rows: 2, value: notes, onChange: (e) => setNotes(e.target.value), placeholder: "Any notes about this shipment..." })] }) }), _jsxs(DialogActions, { children: [_jsx(Button, { onClick: onClose, disabled: submitting, children: "Cancel" }), _jsx(Button, { variant: "contained", color: "success", onClick: () => void handleConfirm(), disabled: submitting, children: submitting ? 'Recording...' : 'Confirm Receipt' })] })] }));
}
function PoProgressTrack({ status }) {
    const theme = useTheme();
    const nodeState = (activeStatuses, confirmedStatuses) => {
        if (confirmedStatuses.includes(status))
            return 'confirmed';
        if (activeStatuses.includes(status))
            return 'active';
        return 'pending';
    };
    const nodes = [
        {
            label: 'Created',
            icon: _jsx(Plus, { size: 16 }),
            state: 'confirmed',
        },
        {
            label: 'On the Way',
            icon: _jsx(Truck, { size: 16 }),
            state: nodeState(['ordered', 'confirmed', 'in_production'], ['shipped', 'partially_received', 'received']),
        },
        {
            label: 'Arrived',
            icon: _jsx(Package, { size: 16 }),
            state: nodeState(['shipped', 'partially_received'], ['received']),
        },
    ];
    return (_jsx(Box, { sx: { display: 'flex', alignItems: 'flex-start', mb: 2 }, children: nodes.map((node, i) => (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', flex: i < nodes.length - 1 ? 1 : 'none' }, children: [_jsxs(Box, { sx: { display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 72 }, children: [_jsx(Box, { sx: {
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
                                        '0%': { boxShadow: '0 0 0 0 rgba(255,107,43,0.55)' },
                                        '70%': { boxShadow: '0 0 0 10px rgba(255,107,43,0)' },
                                        '100%': { boxShadow: '0 0 0 0 rgba(255,107,43,0)' },
                                    },
                                    animation: 'poNodePulse 1.3s ease-out infinite',
                                }),
                                transition: 'all 0.2s',
                            }, children: node.state === 'confirmed' ? _jsx(CheckCircle, { size: 18 }) : node.icon }), _jsxs(Typography, { variant: "caption", sx: {
                                mt: 0.5, fontWeight: 600, fontSize: 10, textTransform: 'uppercase',
                                letterSpacing: '0.06em',
                                color: node.state === 'pending' ? 'text.disabled'
                                    : node.state === 'active' ? 'var(--accent)'
                                        : 'success.main',
                            }, children: [node.state === 'confirmed' ? '✓ ' : '', node.label] })] }), i < nodes.length - 1 && (_jsx(Box, { sx: {
                        flex: 1, height: 2, mx: 0.5, mb: 3,
                        bgcolor: node.state === 'confirmed'
                            ? theme.palette.success.main
                            : theme.palette.divider,
                        transition: 'background-color 0.2s',
                    } }))] }, i))) }));
}
function PoAccordion({ po, onFetchLineItems, onUpdatePoStatus, onCreateReceiveJob, }) {
    const [expanded, setExpanded] = useState(false);
    const [lineItems, setLineItems] = useState(null);
    const [loadingItems, setLoadingItems] = useState(false);
    const [updatingStatus, setUpdatingStatus] = useState(false);
    const [error, setError] = useState(null);
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
            }
            finally {
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
        }
        catch {
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
            }
            catch {
                setError('Failed to load line items.');
            }
            finally {
                setLoadingItems(false);
            }
        }
    };
    const handleStatusUpdate = async (newStatus) => {
        setUpdatingStatus(true);
        try {
            const today = new Date().toISOString().split('T')[0];
            await onUpdatePoStatus(po.id, newStatus, newStatus === 'received' || newStatus === 'partially_received' ? today : undefined);
        }
        catch {
            setError('Failed to update status.');
        }
        finally {
            setUpdatingStatus(false);
        }
    };
    return (_jsxs(Accordion, { expanded: expanded, onChange: () => void handleExpand(), variant: "outlined", sx: { mb: 1.5, borderRadius: '8px !important', '&:before': { display: 'none' } }, children: [_jsx(AccordionSummary, { expandIcon: _jsx(ChevronDown, { size: 16 }), children: _jsx(Box, { sx: { display: 'flex', alignItems: 'center', gap: 2, width: '100%', pr: 1 }, children: _jsxs(Box, { sx: { flex: 1 }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }, children: [_jsx(Typography, { variant: "body2", fontWeight: 700, children: po.supplier_name }), _jsx(Chip, { label: status.label, size: "small", color: status.color })] }), _jsxs(Box, { sx: { display: 'flex', gap: 2 }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.5 }, children: [_jsx(Clock, { size: 12 }), _jsxs(Typography, { variant: "caption", color: "text.secondary", children: ["ETA: ", eta] })] }), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.5 }, children: [_jsx(Package, { size: 12 }), _jsxs(Typography, { variant: "caption", color: "text.secondary", children: [po.total_units_ordered, " units \u00B7 ", po.line_items_count, " lines"] })] }), po.first_line_description && (_jsxs(Typography, { variant: "caption", color: "text.secondary", sx: { fontStyle: 'italic' }, children: [po.first_line_description, Number(po.line_items_count) > 1 ? ` +${Number(po.line_items_count) - 1} more` : ''] }))] })] }) }) }), _jsxs(AccordionDetails, { sx: { pt: 0 }, children: [_jsx(Divider, { sx: { mb: 2 } }), _jsx(PoProgressTrack, { status: po.status }), error && _jsx(Alert, { severity: "error", sx: { mb: 2 }, children: error }), loadingItems && _jsx(ModuleLoadingSkeleton, { rows: 1, height: 20 }), lineItems && (_jsx(TableContainer, { sx: { mb: 2 }, children: _jsxs(Table, { size: "small", children: [_jsx(TableHead, { children: _jsxs(TableRow, { children: [_jsx(TableCell, { sx: { fontWeight: 700, fontSize: 11 }, children: "Product" }), _jsx(TableCell, { sx: { fontWeight: 700, fontSize: 11 }, align: "right", children: "Ordered" }), _jsx(TableCell, { sx: { fontWeight: 700, fontSize: 11 }, align: "right", children: "Received" })] }) }), _jsx(TableBody, { children: lineItems.map((item) => (_jsxs(TableRow, { hover: true, children: [_jsx(TableCell, { sx: { fontSize: 12 }, children: _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1 }, children: [item.image_url ? (_jsx(Box, { component: "img", src: item.image_url, alt: "", sx: { width: 32, height: 32, objectFit: 'cover', borderRadius: 0.5, flexShrink: 0 } })) : (_jsx(Box, { sx: { width: 32, height: 32, borderRadius: 0.5, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, children: _jsx(Package, { size: 14, style: { opacity: 0.4 } }) })), _jsxs(Box, { children: [_jsx(Typography, { variant: "body2", fontWeight: 600, children: item.product_title ?? item.description }), item.sku && _jsx(Typography, { variant: "caption", color: "text.secondary", sx: { fontFamily: 'monospace' }, children: item.sku })] })] }) }), _jsx(TableCell, { align: "right", sx: { fontSize: 12 }, children: item.quantity_ordered }), _jsx(TableCell, { align: "right", sx: { fontSize: 12, fontWeight: item.quantity_received > 0 ? 700 : 400 }, children: item.quantity_received })] }, item.id))) })] }) })), OPEN_STATUSES.includes(po.status) && (_jsxs(Box, { sx: { display: 'flex', gap: 1, flexWrap: 'wrap' }, children: [po.status === 'draft' && (_jsxs(_Fragment, { children: [_jsx(Box, { component: "button", onClick: () => void handleOpenSendPreview(), disabled: updatingStatus || loadingSend, sx: { display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, color: 'var(--accent-ink)', bgcolor: updatingStatus || loadingSend ? 'var(--bg-3)' : 'var(--accent)', border: 'none', borderRadius: '6px', px: 1.25, py: 0.75, cursor: updatingStatus || loadingSend ? 'wait' : 'pointer', '&:hover': { opacity: 0.88 } }, children: loadingSend ? 'Loading…' : 'Prepare to send →' }), _jsx(Box, { component: "button", onClick: () => void handleStatusUpdate('ordered'), disabled: updatingStatus, sx: { display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: '0.5px solid var(--accent)', borderRadius: '6px', px: 1.25, py: 0.75, cursor: updatingStatus ? 'wait' : 'pointer', '&:hover': { opacity: 0.75 } }, children: "Mark as sent" })] })), (po.status === 'ordered' || po.status === 'confirmed' || po.status === 'in_production') && (_jsx(Button, { size: "small", variant: "outlined", color: "success", disabled: updatingStatus, onClick: () => void handleStatusUpdate('shipped'), children: "Mark as arrived" })), (po.status === 'shipped' || po.status === 'partially_received') && (_jsx(Button, { size: "small", variant: "contained", disabled: updatingStatus, startIcon: _jsx(CheckCircle, { size: 14 }), onClick: () => void handleReceive(), sx: { bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }, children: "Receive via WMS" })), _jsx(Button, { size: "small", variant: "outlined", color: "error", disabled: updatingStatus, startIcon: _jsx(XCircle, { size: 14 }), onClick: () => void handleStatusUpdate('cancelled'), children: "Cancel PO" })] })), po.notes && (_jsxs(Typography, { variant: "caption", color: "text.secondary", sx: { mt: 2, display: 'block' }, children: ["Notes: ", po.notes] })), sendPreviewOpen && lineItems && (_jsx(SendPoModal, { po: po, lineItems: lineItems, onClose: () => setSendPreviewOpen(false) }))] })] }));
}
;
function SupplierFormDialog({ open, mode, initial, onClose, onSubmit }) {
    const [form, setForm] = useState({ name: '', contact_name: '', contact_email: '', contact_phone: '', moq: '', lead_time_days: '' });
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
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
        if (!form.name.trim())
            return setError('Name is required.');
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
        }
        catch (e) {
            setError(e?.response?.data?.error ?? 'Failed to save supplier.');
        }
        finally {
            setSubmitting(false);
        }
    };
    return (_jsxs(Dialog, { open: open, onClose: onClose, maxWidth: "sm", fullWidth: true, children: [_jsx(DialogTitle, { children: mode === 'add' ? 'Add supplier' : 'Edit supplier' }), _jsxs(DialogContent, { sx: { display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }, children: [error && _jsx(Alert, { severity: "error", children: error }), _jsx(TextField, { label: "Name *", size: "small", fullWidth: true, value: form.name, onChange: (e) => setForm((p) => ({ ...p, name: e.target.value })) }), _jsx(TextField, { label: "Contact name", size: "small", fullWidth: true, value: form.contact_name, onChange: (e) => setForm((p) => ({ ...p, contact_name: e.target.value })) }), _jsx(TextField, { label: "Email", size: "small", fullWidth: true, value: form.contact_email, onChange: (e) => setForm((p) => ({ ...p, contact_email: e.target.value })) }), _jsx(TextField, { label: "Phone", size: "small", fullWidth: true, value: form.contact_phone, onChange: (e) => setForm((p) => ({ ...p, contact_phone: e.target.value })) }), _jsx(TextField, { label: "Min order qty (MOQ)", type: "number", size: "small", fullWidth: true, value: form.moq, onChange: (e) => setForm((p) => ({ ...p, moq: e.target.value })), helperText: "Units this supplier requires per order. Leave blank for no minimum." }), _jsx(TextField, { label: "Lead time (days)", type: "number", size: "small", fullWidth: true, value: form.lead_time_days, onChange: (e) => setForm((p) => ({ ...p, lead_time_days: e.target.value })), helperText: "Days from PO sent to goods received. Used to compute the best reorder date." })] }), _jsxs(DialogActions, { children: [_jsx(Button, { onClick: onClose, color: "inherit", children: "Cancel" }), _jsx(Button, { onClick: handleSave, disabled: submitting, variant: "contained", sx: { bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }, children: mode === 'add' ? 'Add supplier' : 'Save changes' })] })] }));
}
// ─────────────────────────────────────────────
// SUPPLIER ACCORDION
// ─────────────────────────────────────────────
function SupplierAccordion({ supplier, onEdit, onDelete }) {
    return (_jsxs(Accordion, { variant: "outlined", sx: { mb: 1, borderRadius: '8px !important', '&:before': { display: 'none' } }, children: [_jsx(AccordionSummary, { expandIcon: _jsx(ChevronDown, { size: 16 }), children: _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 2, width: '100%', pr: 1 }, children: [_jsx(Box, { sx: { flex: 1 }, children: _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1 }, children: [_jsx(Typography, { variant: "body2", fontWeight: 700, children: supplier.name }), !supplier.active && _jsx(Chip, { label: "Inactive", size: "small" }), Number(supplier.open_po_count) > 0 && (_jsx(Chip, { label: `${supplier.open_po_count} open PO${Number(supplier.open_po_count) > 1 ? 's' : ''}`, size: "small", color: "primary" }))] }) }), _jsxs(Box, { sx: { display: 'flex', gap: 1.5 }, children: [_jsx(RatingBadge, { label: "On-time", value: supplier.on_time_rate }), _jsx(RatingBadge, { label: "Fill", value: supplier.fill_rate })] })] }) }), _jsxs(AccordionDetails, { sx: { pt: 0 }, children: [_jsx(Divider, { sx: { mb: 1.5 } }), _jsxs(Box, { sx: { display: 'flex', flexDirection: 'column', gap: 0.5 }, children: [supplier.contact_name && (_jsxs(Typography, { variant: "caption", color: "text.secondary", children: ["Contact: ", supplier.contact_name] })), supplier.contact_email && (_jsxs(Typography, { variant: "caption", color: "text.secondary", children: ["Email: ", supplier.contact_email] })), supplier.contact_phone && (_jsxs(Typography, { variant: "caption", color: "text.secondary", children: ["Phone: ", supplier.contact_phone] })), _jsxs(Typography, { variant: "caption", color: "text.secondary", children: ["Received POs: ", supplier.total_pos] }), supplier.defect_rate !== null && (_jsxs(Typography, { variant: "caption", color: "text.secondary", children: ["Defect rate: ", supplier.defect_rate, "%"] })), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1 }, children: [_jsxs(Typography, { variant: "caption", color: "text.secondary", children: ["MOQ: ", supplier.moq != null ? `${supplier.moq} units` : '—'] }), supplier.moq == null && (_jsx(Box, { component: "span", onClick: () => onEdit(supplier), sx: { fontSize: 11, color: 'var(--accent)', cursor: 'pointer', '&:hover': { opacity: 0.75 } }, children: "Set minimum order \u2192" }))] }), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1 }, children: [_jsxs(Typography, { variant: "caption", color: "text.secondary", children: ["Lead time: ", supplier.lead_time_days != null ? `${supplier.lead_time_days} days` : '—'] }), supplier.lead_time_days == null && (_jsx(Box, { component: "span", onClick: () => onEdit(supplier), sx: { fontSize: 11, color: 'var(--accent)', cursor: 'pointer', '&:hover': { opacity: 0.75 } }, children: "Set delivery time \u2192" }))] })] }), _jsxs(Box, { sx: { display: 'flex', gap: 1, mt: 1.5 }, children: [_jsx(Button, { size: "small", variant: "outlined", onClick: () => onEdit(supplier), children: "Edit" }), _jsx(Button, { size: "small", variant: "outlined", color: "error", onClick: () => onDelete(supplier), children: "Delete" })] })] })] }));
}
// ─────────────────────────────────────────────
// MAIN MODULE
// ─────────────────────────────────────────────
function PurchasingPosView({ data, isLoading, isError, onRefresh, onFetchLineItems, onUpdatePoStatus, onCreateSupplier, onCreatePo, onCreateReceiveJob, onSearchVariants, autoOpenCreatePo = false, prefilledLineItem, spotlights, }) {
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
    return (_jsxs(Box, { sx: { p: 2, maxWidth: 700, mx: 'auto' }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }, children: [_jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 22, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2 }, children: "Open POs" }), _jsx(Typography, { variant: "body2", color: "text.secondary", sx: { mt: 0.5 }, children: "Purchase orders and ETAs." })] }), _jsx(Button, { variant: "contained", startIcon: _jsx(Plus, { size: 16 }), onClick: () => setCreatePoOpen(true), sx: { bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }, children: "New PO" })] }), isLoading && _jsx(ModuleLoadingSkeleton, {}), isError && (_jsx(Alert, { severity: "error", sx: { mb: 3 }, children: "Failed to load supplier data. Please refresh." })), !isLoading && !isError && (_jsxs(_Fragment, { children: [_jsxs(Box, { sx: { mb: 4 }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, mb: 2 }, children: [_jsx(Truck, { size: 18 }), _jsx(Typography, { variant: "subtitle1", fontWeight: 700, children: "Open Purchase Orders" }), _jsx(Chip, { label: openPos.length, size: "small", color: openPos.length > 0 ? 'primary' : 'default' })] }), openPos.some((po) => po.status === 'draft') && spotlights && !spotlights.poSendFlow.isDismissed && (_jsx(Box, { sx: { mb: 2 }, children: _jsx(SpotlightCoachMark, { title: "Ready to order? Copy and send to your supplier", body: 'Open any draft PO, click "Prepare to send \u2192" to copy the order details, then paste into email, WhatsApp, or however you contact this supplier. Once sent, click "Mark as sent" to update the status.', isDismissed: spotlights.poSendFlow.isDismissed, onDismiss: spotlights.poSendFlow.dismiss, step: 1, totalSteps: 1 }) })), openPos.length === 0 ? (_jsxs(Paper, { variant: "outlined", sx: { textAlign: 'center', py: 6, borderRadius: 2, borderStyle: 'dashed' }, children: [_jsx(Truck, { size: 36, style: { opacity: 0.3 } }), _jsx(Typography, { variant: "body2", color: "text.secondary", sx: { mt: 2 }, children: "No open purchase orders." }), _jsx(Button, { size: "small", startIcon: _jsx(Plus, { size: 14 }), sx: { mt: 2 }, onClick: () => setCreatePoOpen(true), children: "Create your first PO" })] })) : (openPos.map((po) => (_jsx(PoAccordion, { po: po, onFetchLineItems: onFetchLineItems, onUpdatePoStatus: onUpdatePoStatus, onCreateReceiveJob: onCreateReceiveJob }, po.id))))] }), closedPos.length > 0 && (_jsxs(Box, { sx: { mb: 4 }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, mb: 1, cursor: 'pointer' }, onClick: () => setShowClosed((v) => !v), children: [_jsxs(Typography, { variant: "subtitle2", color: "text.secondary", children: [closedPos.length, " closed / cancelled PO", closedPos.length > 1 ? 's' : ''] }), _jsx(ChevronDown, { size: 14, style: { transform: showClosed ? 'rotate(180deg)' : 'none', transition: '0.2s' } })] }), showClosed && closedPos.map((po) => (_jsx(PoAccordion, { po: po, onFetchLineItems: onFetchLineItems, onUpdatePoStatus: onUpdatePoStatus, onCreateReceiveJob: onCreateReceiveJob }, po.id)))] }))] })), _jsx(CreatePoDialog, { open: createPoOpen, suppliers: suppliers, prefilledLineItem: prefilledLineItem, onClose: handlePoCreated, onCreateSupplier: onCreateSupplier, onCreatePo: onCreatePo, onSearchVariants: onSearchVariants })] }));
}
function PurchasingSuppliersView({ data, isLoading, isError, onUpdateSupplier, onCreateSupplier, onDeleteSupplier, }) {
    const [supplierFormOpen, setSupplierFormOpen] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState(null);
    const suppliers = data?.suppliers ?? [];
    return (_jsxs(Box, { sx: { p: 2, maxWidth: 700, mx: 'auto' }, children: [isLoading && _jsx(ModuleLoadingSkeleton, {}), isError && (_jsx(Alert, { severity: "error", sx: { mb: 3 }, children: "Failed to load supplier data. Please refresh." })), !isLoading && !isError && (_jsxs(Box, { children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, mb: 2 }, children: [_jsx(Star, { size: 18 }), _jsx(Typography, { variant: "subtitle1", fontWeight: 700, children: "Suppliers" }), _jsx(Chip, { label: suppliers.length, size: "small" }), _jsx(Box, { sx: { flex: 1 } }), _jsx(Button, { size: "small", startIcon: _jsx(Plus, { size: 16 }), variant: "contained", onClick: () => { setEditingSupplier(null); setSupplierFormOpen(true); }, sx: { bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }, children: "Add supplier" })] }), suppliers.length === 0 ? (_jsxs(Paper, { variant: "outlined", sx: { textAlign: 'center', py: 6, borderRadius: 2, borderStyle: 'dashed' }, children: [_jsx(Star, { size: 36, style: { opacity: 0.3 } }), _jsx(Typography, { variant: "body2", color: "text.secondary", sx: { mt: 2 }, children: "No suppliers added yet. Create a PO to add your first supplier." })] })) : (suppliers.map((s) => (_jsx(SupplierAccordion, { supplier: s, onEdit: (sup) => { setEditingSupplier(sup); setSupplierFormOpen(true); }, onDelete: async (sup) => {
                            if (window.confirm(`Remove ${sup.name}? Past purchase orders are kept; the supplier is hidden from new POs.`)) {
                                await onDeleteSupplier(sup.id);
                            }
                        } }, s.id))))] })), _jsx(SupplierFormDialog, { open: supplierFormOpen, mode: editingSupplier ? 'edit' : 'add', initial: editingSupplier ?? undefined, onClose: () => { setSupplierFormOpen(false); setEditingSupplier(null); }, onSubmit: async (input) => {
                    if (editingSupplier)
                        await onUpdateSupplier(editingSupplier.id, input);
                    else
                        await onCreateSupplier(input);
                } })] }));
}
;
function AssignSupplierDialog({ open, target, suppliers, onClose, onSubmit, }) {
    const [supplierId, setSupplierId] = useState('');
    const [scopeType, setScopeType] = useState('variant');
    const [priority, setPriority] = useState(1);
    const [note, setNote] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => {
        if (open) {
            setSupplierId('');
            setScopeType('variant');
            setPriority(1);
            setNote('');
            setError(null);
        }
    }, [open]);
    const scopeId = scopeType === 'variant' ? (target?.lasyncro_variant_id ?? '') :
        scopeType === 'product' ? (target?.product_id ?? '') :
            (target?.product_type ?? '');
    const scopeOptions = [
        { value: 'variant', label: 'Apply to this variant only' },
        ...(target?.product_id ? [{ value: 'product', label: 'Apply to all variants of this product' }] : []),
        ...(target?.product_type ? [{ value: 'product_type', label: `Apply to all "${target.product_type}" products` }] : []),
    ];
    const handleSubmit = async () => {
        if (!supplierId)
            return setError('Please select a supplier.');
        if (!scopeId)
            return setError('Scope ID could not be resolved. Try "this variant only".');
        setSubmitting(true);
        try {
            await onSubmit({ supplier_id: Number(supplierId), scope_type: scopeType, scope_id: scopeId, priority, note: note.trim() || undefined });
            onClose();
        }
        catch (e) {
            setError(e?.response?.data?.error ?? 'Failed to assign supplier.');
        }
        finally {
            setSubmitting(false);
        }
    };
    return (_jsxs(Dialog, { open: open, onClose: onClose, maxWidth: "sm", fullWidth: true, children: [_jsxs(DialogTitle, { children: ["Assign supplier", target && (_jsxs(Typography, { variant: "caption", color: "text.secondary", sx: { display: 'block', mt: 0.25 }, children: [target.title, target.sku ? ` · ${target.sku}` : ''] }))] }), _jsxs(DialogContent, { sx: { display: 'flex', flexDirection: 'column', gap: 2, pt: 1.5 }, children: [error && _jsx(Alert, { severity: "error", children: error }), _jsx(TextField, { select: true, label: "Supplier", value: supplierId, onChange: (e) => setSupplierId(e.target.value), fullWidth: true, size: "small", children: suppliers.filter((s) => s.active).map((s) => (_jsx(MenuItem, { value: String(s.id), children: s.name }, s.id))) }), _jsxs(Box, { children: [_jsx(Typography, { variant: "caption", fontWeight: 700, color: "text.secondary", sx: { display: 'block', mb: 0.75 }, children: "APPLY TO" }), _jsx(Box, { sx: { display: 'flex', flexDirection: 'column', gap: 0.5 }, children: scopeOptions.map((opt) => (_jsxs(Box, { onClick: () => setScopeType(opt.value), sx: { display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 1, borderRadius: 1.5, border: '1px solid', borderColor: scopeType === opt.value ? 'var(--accent)' : 'divider', cursor: 'pointer', bgcolor: scopeType === opt.value ? 'var(--accent-ghost)' : 'transparent', transition: 'all 0.15s' }, children: [_jsx(Box, { sx: { width: 16, height: 16, borderRadius: '50%', border: '2px solid', borderColor: scopeType === opt.value ? 'var(--accent)' : 'action.disabled', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, children: scopeType === opt.value && _jsx(Box, { sx: { width: 8, height: 8, borderRadius: '50%', bgcolor: 'var(--accent)' } }) }), _jsx(Typography, { variant: "body2", children: opt.label })] }, opt.value))) })] }), _jsxs(Box, { children: [_jsx(Typography, { variant: "caption", fontWeight: 700, color: "text.secondary", sx: { display: 'block', mb: 0.75 }, children: "PRIORITY" }), _jsx(Box, { sx: { display: 'flex', gap: 1 }, children: [{ v: 1, label: 'Primary' }, { v: 2, label: 'Backup' }].map(({ v, label }) => (_jsx(Box, { onClick: () => setPriority(v), sx: { flex: 1, textAlign: 'center', px: 1.5, py: 1, borderRadius: 1.5, border: '1px solid', borderColor: priority === v ? 'var(--accent)' : 'divider', cursor: 'pointer', bgcolor: priority === v ? 'var(--accent-ghost)' : 'transparent', transition: 'all 0.15s' }, children: _jsx(Typography, { variant: "body2", fontWeight: priority === v ? 600 : 400, children: label }) }, v))) })] }), _jsx(TextField, { label: "Note (optional)", size: "small", fullWidth: true, multiline: true, rows: 2, value: note, onChange: (e) => setNote(e.target.value), placeholder: "Why this supplier for this product..." })] }), _jsxs(DialogActions, { children: [_jsx(Button, { onClick: onClose, disabled: submitting, color: "inherit", children: "Cancel" }), _jsx(Button, { variant: "contained", onClick: () => void handleSubmit(), disabled: submitting || !supplierId, sx: { bgcolor: 'var(--accent)', color: 'var(--accent-ink)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }, children: submitting ? 'Saving...' : 'Assign supplier' })] })] }));
}
;
function PurchasingSourcingView({ data, onCreatePo, onCreateSupplier, onSearchVariants, onFetchSourcingRecommendations, onFetchPreferences, onCreatePreference, onDeletePreference, onFetchReorderRequests, onCreateReorderRequest, onDeleteReorderRequest, onConvertReorderRequests, lastConvertedPoId, onDismissConvertedPo, spotlights, }) {
    const neverOrdered = data?.never_ordered ?? [];
    const neverOrderedCount = data?.never_ordered_count ?? 0;
    const suppliers = data?.suppliers ?? [];
    const [searchParams] = useSearchParams();
    const triggerVariantId = searchParams.get('variantId');
    // §8: needed qty from alert deep-link — used for "Add to queue" pre-fill
    const neededQty = Number(searchParams.get('needed') ?? 1) || 1;
    const [activeVariantId, setActiveVariantId] = useState(triggerVariantId);
    const [recommendations, setRecommendations] = useState([]);
    const [isLoadingRecs, setIsLoadingRecs] = useState(false);
    const [preferences, setPreferences] = useState([]);
    const [isLoadingPrefs, setIsLoadingPrefs] = useState(false);
    // §8 reorder accumulator state
    const [reorderRequests, setReorderRequests] = useState([]);
    const [convertingSupplierIds, setConvertingSupplierIds] = useState(new Set());
    const [createPoOpen, setCreatePoOpen] = useState(false);
    const [poVariantId, setPoVariantId] = useState(undefined);
    const [poSupplierId, setPoSupplierId] = useState(undefined);
    const [assignTarget, setAssignTarget] = useState(null);
    const [assignOpen, setAssignOpen] = useState(false);
    // §8: per-supplier queue button state — 'idle' | 'adding' | 'added'
    const [queueButtonState, setQueueButtonState] = useState({});
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
    const handleAddToQueue = async (variantId, supplierId) => {
        setQueueButtonState((prev) => ({ ...prev, [supplierId]: 'adding' }));
        try {
            await onCreateReorderRequest({ lasyncro_variant_id: variantId, supplier_id: supplierId, qty_requested: neededQty, source: triggerVariantId ? 'alert' : 'manual' });
            const updated = await onFetchReorderRequests();
            setReorderRequests(updated);
            // Flash "Added ✓" for 1.5s so merchant knows the click registered
            setQueueButtonState((prev) => ({ ...prev, [supplierId]: 'added' }));
            setTimeout(() => setQueueButtonState((prev) => ({ ...prev, [supplierId]: 'idle' })), 1500);
        }
        catch {
            setQueueButtonState((prev) => ({ ...prev, [supplierId]: 'idle' }));
        }
    };
    // §8: convert all pending for a supplier → draft PO, then clear from accumulator
    const handleConvert = async (supplierId) => {
        setConvertingSupplierIds((prev) => new Set(prev).add(supplierId));
        try {
            // onConvertReorderRequests sets lastConvertedPoId at page level
            // before refetch so banner survives the re-render
            await onConvertReorderRequests(supplierId);
            const updated = await onFetchReorderRequests();
            setReorderRequests(updated);
        }
        finally {
            setConvertingSupplierIds((prev) => { const s = new Set(prev); s.delete(supplierId); return s; });
        }
    };
    useEffect(() => {
        if (!activeVariantId)
            return;
        setIsLoadingRecs(true);
        onFetchSourcingRecommendations(activeVariantId)
            .then(setRecommendations)
            .finally(() => setIsLoadingRecs(false));
    }, [activeVariantId, onFetchSourcingRecommendations]);
    const handleCreatePoFromRec = (variantId, supplierId) => {
        setPoVariantId(variantId);
        setPoSupplierId(supplierId);
        setCreatePoOpen(true);
    };
    const handleAssignOpen = (v) => {
        setAssignTarget({ lasyncro_variant_id: v.lasyncro_variant_id, title: v.title, sku: v.sku, product_id: v.product_id, product_type: v.product_type });
        setAssignOpen(true);
    };
    const handleAssignSave = async (input) => {
        await onCreatePreference(input);
        const updated = await onFetchPreferences();
        setPreferences(updated);
    };
    const handleDeletePreference = async (id) => {
        await onDeletePreference(id);
        setPreferences((prev) => prev.filter((p) => p.id !== id));
    };
    const goodMatches = recommendations.filter(r => !r.exceeds_moq);
    const exceedsMoqMatches = recommendations.filter(r => r.exceeds_moq);
    const prefsByScope = {
        variant: preferences.filter(p => p.scope_type === 'variant'),
        product: preferences.filter(p => p.scope_type === 'product'),
        product_type: preferences.filter(p => p.scope_type === 'product_type'),
    };
    const scopeLabels = { variant: 'Variant', product: 'Product', product_type: 'Product Type' };
    return (_jsxs(Box, { sx: { p: 2 }, children: [_jsxs(Box, { sx: { display: 'flex', flexWrap: 'wrap', gap: 2.25, alignItems: 'start' }, children: [_jsxs(Box, { sx: { flex: '1 0 300px', minWidth: 0, bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', overflow: 'hidden' }, children: [_jsxs(Box, { sx: { p: '18px 20px', borderBottom: '1px solid var(--rule)' }, children: [_jsx(Typography, { sx: { fontSize: 16, fontWeight: 500, color: 'var(--ink)' }, children: "Sourcing recommendations" }), _jsx(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-3)', mt: 0.25 }, children: activeVariantId ? 'Ranked by supplier reliability — on-time rate, fill rate, defect rate' : 'Select a stockout alert to see ranked supplier options' })] }), !activeVariantId && (_jsxs(Box, { sx: { borderBottom: '1px solid var(--rule)' }, children: [_jsxs(Box, { sx: { px: 2.5, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [_jsx(Typography, { sx: { fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }, children: "Supplier preferences" }), !isLoadingPrefs && preferences.length === 0 && (_jsx(Typography, { sx: { fontSize: 12, color: 'var(--ink-4)' }, children: "None set" }))] }), isLoadingPrefs && _jsx(Box, { sx: { px: 2.5, pb: 2 }, children: _jsx(ModuleLoadingSkeleton, { rows: 1, height: 16 }) }), !isLoadingPrefs && preferences.length > 0 && (_jsx(_Fragment, { children: ['variant', 'product', 'product_type'].map((scope) => {
                                            const rows = prefsByScope[scope];
                                            if (!rows.length)
                                                return null;
                                            return (_jsxs(Box, { children: [_jsx(Box, { sx: { px: 2.5, py: 0.75, bgcolor: 'var(--bg-2)' }, children: _jsx(Typography, { sx: { fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink-4)' }, children: scopeLabels[scope] }) }), rows.map((pref) => (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', px: 2.5, py: 1.5, borderTop: '1px solid var(--rule)', gap: 1.5 }, children: [_jsxs(Box, { sx: { flex: 1, minWidth: 0 }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1 }, children: [_jsx(Typography, { sx: { fontSize: 13, fontWeight: 500, color: 'var(--ink)' }, children: pref.supplier_name }), _jsx(Chip, { label: pref.priority === 1 ? 'Primary' : 'Backup', size: "small", sx: { fontSize: 10, height: 18, bgcolor: pref.priority === 1 ? 'rgba(255,107,43,0.12)' : 'action.hover', color: pref.priority === 1 ? 'var(--accent)' : 'text.secondary' } })] }), _jsx(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)', fontFamily: 'monospace', mt: 0.25 }, children: pref.scope_id }), pref.note && _jsx(Typography, { sx: { fontSize: 11, color: 'var(--ink-3)', mt: 0.25, fontStyle: 'italic' }, children: pref.note })] }), _jsx(IconButton, { size: "small", onClick: () => void handleDeletePreference(pref.id), sx: { color: 'text.disabled', '&:hover': { color: 'error.main' } }, children: _jsx(Trash2, { size: 14 }) })] }, pref.id)))] }, scope));
                                        }) }))] })), activeVariantId && isLoadingRecs && (_jsx(Box, { sx: { p: 4, textAlign: 'center' }, children: _jsx(Typography, { sx: { fontSize: 13, color: 'var(--ink-3)' }, children: "Loading recommendations\u2026" }) })), activeVariantId && !isLoadingRecs && recommendations.length === 0 && (_jsx(Box, { sx: { p: 4, textAlign: 'center' }, children: _jsx(Typography, { sx: { fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }, children: "No supplier history for this product yet." }) })), activeVariantId && !isLoadingRecs && goodMatches.length > 0 && spotlights && !spotlights.alertTriggered.isDismissed && (_jsx(Box, { sx: { px: 2.5, pt: 1.5, borderTop: '1px solid var(--rule)' }, children: _jsx(SpotlightCoachMark, { title: "Your best supplier, ranked automatically", body: "Rankings are based on delivery speed, order accuracy, and quality from your real orders. Order now, or add to queue to combine with other products before sending.", isDismissed: spotlights.alertTriggered.isDismissed, onDismiss: spotlights.alertTriggered.dismiss, step: 2, totalSteps: 3 }) })), goodMatches.map((rec) => (_jsxs(Box, { sx: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2.5, py: 1.75, borderTop: '1px solid var(--rule)' }, children: [_jsxs(Box, { children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1 }, children: [_jsx(Typography, { sx: { fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }, children: rec.name }), rec.is_preferred && (_jsx(Chip, { label: "\u2605 Preferred", size: "small", sx: { fontSize: 10, height: 18, bgcolor: 'var(--accent-ghost)', color: 'var(--accent)' } }))] }), _jsx(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }, children: (() => {
                                                    const parts = [
                                                        rec.on_time_rate != null && `On-time ${rec.on_time_rate}%`,
                                                        rec.fill_rate != null && `Fill ${rec.fill_rate}%`,
                                                        rec.lead_time_days != null && `Lead ${rec.lead_time_days}d`,
                                                    ].filter(Boolean);
                                                    return parts.length > 0 ? parts.join(' · ') : 'No order history yet';
                                                })() })] }), _jsxs(Box, { sx: { display: 'flex', gap: 1, flexShrink: 0 }, children: [(() => {
                                                const btnState = queueButtonState[rec.id] ?? 'idle';
                                                const isAdding = btnState === 'adding';
                                                const isAdded = btnState === 'added';
                                                return (_jsx(Box, { component: "button", onClick: () => activeVariantId && btnState === 'idle' && void handleAddToQueue(activeVariantId, rec.id), sx: { display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 500,
                                                        color: isAdded ? 'var(--confirm-ink)' : 'var(--accent)',
                                                        bgcolor: isAdded ? 'var(--confirm-ghost)' : 'transparent',
                                                        border: `0.5px solid ${isAdded ? 'var(--confirm-border)' : 'var(--accent)'}`,
                                                        borderRadius: '6px', px: 1.25, py: 0.75,
                                                        cursor: btnState === 'idle' ? 'pointer' : 'default',
                                                        transition: 'all 0.2s',
                                                        '&:hover': { opacity: btnState === 'idle' ? 0.75 : 1 } }, children: isAdding ? 'Adding…' : isAdded ? 'Added ✓' : 'Add to queue →' }));
                                            })(), _jsx(Box, { component: "button", onClick: () => activeVariantId && handleCreatePoFromRec(activeVariantId, rec.id), sx: { display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, color: 'var(--accent-ink)', bgcolor: 'var(--accent)', border: 'none', borderRadius: '6px', px: 1.25, py: 0.75, cursor: 'pointer', '&:hover': { opacity: 0.88 } }, children: "Create PO \u2192" })] })] }, rec.id))), exceedsMoqMatches.map((rec) => (_jsxs(Box, { sx: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2.5, py: 1.75, borderTop: '1px solid var(--rule)', opacity: 0.7 }, children: [_jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }, children: rec.name }), _jsxs(Typography, { sx: { fontSize: 12, fontWeight: 300, color: '#C62828' }, children: ["Exceeds MOQ (", rec.moq, " units)"] })] }), _jsx(Box, { component: "button", onClick: () => activeVariantId && handleCreatePoFromRec(activeVariantId, rec.id), sx: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: '0.5px solid var(--accent)', borderRadius: '6px', px: 1.25, py: 0.75, cursor: 'pointer', '&:hover': { opacity: 0.75 } }, children: "Create PO anyway \u2192" })] }, rec.id))), lastConvertedPoId && (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2.5, py: 1.5, borderTop: '1px solid var(--rule)', bgcolor: 'var(--accent-ghost)' }, children: [_jsx(Typography, { sx: { fontSize: 12, color: 'var(--accent)', fontWeight: 500 }, children: "Draft PO created \u2014 check Open POs to review and send." }), _jsx(Box, { component: "button", onClick: () => onDismissConvertedPo?.(), sx: { display: 'inline-flex', alignItems: 'center', fontSize: 11, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: '0.5px solid var(--accent)', borderRadius: '6px', px: 1, py: 0.5, cursor: 'pointer', '&:hover': { opacity: 0.75 } }, children: "Dismiss" })] })), reorderRequests.length > 0 && (_jsxs(Box, { sx: { borderTop: '1px solid var(--rule)' }, children: [_jsx(Box, { sx: { px: 2.5, py: 1.5, bgcolor: 'var(--bg-2)' }, children: _jsxs(Typography, { sx: { fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }, children: ["Pending reorders \u00B7 ", reorderRequests.length, " supplier", reorderRequests.length > 1 ? 's' : ''] }) }), spotlights && !spotlights.accumulator.isDismissed && (_jsx(Box, { sx: { px: 2.5, pt: 1.5 }, children: _jsx(SpotlightCoachMark, { title: "Building up your order before sending", body: "Products queue here by supplier. Once you've added enough to meet their minimum order, Create PO lights up. You can always send early if you need to.", isDismissed: spotlights.accumulator.isDismissed, onDismiss: spotlights.accumulator.dismiss, step: 3, totalSteps: 3 }) })), reorderRequests.map((group) => {
                                        const moqPct = group.moq ? Math.min(100, Math.round((group.total_qty / group.moq) * 100)) : null;
                                        const converting = convertingSupplierIds.has(group.supplier_id);
                                        return (_jsxs(Box, { sx: { px: 2.5, py: 1.75, borderTop: '1px solid var(--rule)' }, children: [_jsxs(Box, { sx: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1, mb: 1 }, children: [_jsxs(Box, { sx: { minWidth: 0, flex: 1 }, children: [_jsx(Typography, { sx: { fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }, children: group.supplier_name }), _jsxs(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)', mt: 0.25 }, children: [group.requests.slice(0, 3).map(r => `${r.sku ?? r.title ?? '?'} ${r.qty_requested}u`).join(' · '), group.requests.length > 3 ? ` · +${group.requests.length - 3} more` : ''] })] }), group.moq_met ? (_jsx(Box, { component: "button", onClick: () => !converting && void handleConvert(group.supplier_id), sx: { display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, color: 'var(--accent-ink)', bgcolor: 'var(--accent)', border: 'none', borderRadius: '6px', px: 1.25, py: 0.75, cursor: converting ? 'wait' : 'pointer', '&:hover': { opacity: 0.88 }, flexShrink: 0 }, children: converting ? 'Creating…' : 'Create PO →' })) : (_jsx(Box, { component: "button", onClick: () => !converting && void handleConvert(group.supplier_id), sx: { display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: '0.5px solid var(--accent)', borderRadius: '6px', px: 1.25, py: 0.75, cursor: converting ? 'wait' : 'pointer', '&:hover': { opacity: 0.75 }, flexShrink: 0 }, children: converting ? 'Creating…' : 'Create PO anyway →' }))] }), group.moq !== null && (_jsxs(Box, { children: [_jsx(Box, { sx: { height: 4, borderRadius: 2, bgcolor: 'var(--bg-3)', overflow: 'hidden', mb: 0.5 }, children: _jsx(Box, { sx: { height: '100%', width: `${moqPct}%`, bgcolor: group.moq_met ? 'var(--accent)' : 'var(--ink-3)', borderRadius: 2, transition: 'width 0.3s' } }) }), _jsxs(Typography, { sx: { fontSize: 10, color: group.moq_met ? 'var(--accent)' : 'var(--ink-4)' }, children: [group.total_qty, " / ", group.moq, " units", group.moq_met ? ' — MOQ met' : ' — MOQ not met'] })] }))] }, group.supplier_id));
                                    })] })), neverOrderedCount > 0 && (_jsxs(Box, { sx: { borderTop: '1px solid var(--rule)' }, children: [_jsx(Box, { sx: { px: 2.5, py: 1.5, bgcolor: 'var(--bg-2)' }, children: _jsxs(Typography, { sx: { fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }, children: ["Never ordered before \u00B7 ", neverOrderedCount] }) }), spotlights && !spotlights.neverOrdered.isDismissed && (_jsx(Box, { sx: { px: 2.5, pt: 1.5 }, children: _jsx(SpotlightCoachMark, { title: "These products have no supplier yet", body: "Assign a supplier to each one \u2014 so when stock runs low, you already know who to order from.", isDismissed: spotlights.neverOrdered.isDismissed, onDismiss: spotlights.neverOrdered.dismiss, step: 1, totalSteps: 3 }) })), neverOrdered.slice(0, 4).map((v) => (_jsxs(Box, { sx: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2.5, py: 1.75, borderTop: '1px solid var(--rule)' }, children: [_jsxs(Box, { sx: { minWidth: 0 }, children: [_jsxs(Typography, { sx: { fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }, children: [v.product_title ?? v.title, " ", v.sku ? `· ${v.sku}` : ''] }), !v.has_sku && (_jsx(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)', mt: 0.25 }, children: "No SKU \u2014 add one in Shopify to enable ordering" }))] }), _jsx(Box, { component: "button", onClick: () => handleAssignOpen(v), sx: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: '0.5px solid var(--accent)', borderRadius: '6px', px: 1.25, py: 0.75, cursor: 'pointer', '&:hover': { opacity: 0.75 } }, children: "Assign a supplier \u2192" })] }, v.lasyncro_variant_id)))] }))] }), _jsxs(Box, { sx: { flex: '0 0 300px', bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', p: '18px 20px' }, children: [_jsx(Typography, { sx: { fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)', mb: 1.5 }, children: "Sourcing pulse" }), _jsxs(Box, { sx: { display: 'flex', justifyContent: 'space-between', mb: 1 }, children: [_jsx(Typography, { sx: { fontSize: 13, color: 'var(--ink-3)' }, children: "Never ordered before" }), _jsx(Typography, { sx: { fontSize: 13, fontWeight: 600, color: 'var(--ink)' }, children: neverOrderedCount })] }), _jsxs(Box, { sx: { display: 'flex', justifyContent: 'space-between', mb: 1 }, children: [_jsx(Typography, { sx: { fontSize: 13, color: 'var(--ink-3)' }, children: "Ready to order" }), _jsx(Typography, { sx: { fontSize: 13, fontWeight: 600, color: 'var(--ink)' }, children: goodMatches.length })] }), _jsxs(Box, { sx: { display: 'flex', justifyContent: 'space-between', mb: 1 }, children: [_jsx(Typography, { sx: { fontSize: 13, color: 'var(--ink-3)' }, children: "Preferences set" }), _jsx(Typography, { sx: { fontSize: 13, fontWeight: 600, color: 'var(--ink)' }, children: preferences.length })] }), _jsxs(Box, { sx: { display: 'flex', justifyContent: 'space-between' }, children: [_jsx(Typography, { sx: { fontSize: 13, color: 'var(--ink-3)' }, children: "Queued for reorder" }), _jsx(Typography, { sx: { fontSize: 13, fontWeight: 600, color: 'var(--ink)' }, children: reorderRequests.reduce((sum, g) => sum + g.requests.length, 0) })] })] })] }), _jsx(CreatePoDialog, { open: createPoOpen, suppliers: suppliers, onClose: () => setCreatePoOpen(false), onCreateSupplier: onCreateSupplier, onCreatePo: onCreatePo, onSearchVariants: onSearchVariants, prefilledLineItem: poVariantId ? { description: '', quantity_ordered: 1, lasyncro_variant_id: poVariantId } : undefined, prefilledSupplierId: poSupplierId }), _jsx(AssignSupplierDialog, { open: assignOpen, target: assignTarget, suppliers: suppliers, onClose: () => setAssignOpen(false), onSubmit: handleAssignSave })] }));
}
function SuppliersPortalModuleFT2Inner(props) {
    if (props.view === 'suppliers')
        return _jsx(PurchasingSuppliersView, { ...props });
    if (props.view === 'sourcing')
        return _jsx(PurchasingSourcingView, { ...props });
    return _jsx(PurchasingPosView, { ...props });
}
;
export default function SuppliersPortalModuleFT2(props) {
    const [searchParams] = useSearchParams();
    const autoOpenCreatePo = searchParams.get('action') === 'create-po';
    const prefilledLineItem = autoOpenCreatePo
        ? {
            description: searchParams.get('description') ?? searchParams.get('sku') ?? '',
            quantity_ordered: Number(searchParams.get('qty') ?? 0) || 0,
            lasyncro_variant_id: searchParams.get('variantId') ?? undefined,
        }
        : undefined;
    return (_jsx(ModuleErrorBoundary, { moduleName: "suppliers-portal", children: _jsx(SuppliersPortalModuleFT2Inner, { ...props, autoOpenCreatePo: autoOpenCreatePo, prefilledLineItem: prefilledLineItem }) }));
}
//# sourceMappingURL=SuppliersPortalModuleFT2.js.map