import { useEffect, useMemo, useState } from 'react';
import { Box, Button, Typography, TextField } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
import type { CatalogVariant } from '../products/useProductsCatalog';
import { useVariantWarehouseBins, type VariantWarehouseBin } from '../floor-planning/useVariantWarehouseBins';
import { useCommercialAccess } from '../../runtime/commercialContext';

function uniqueBins(bins: VariantWarehouseBin[]) {
  const byCode = new Map<string, number>();
  for (const bin of bins) {
    const code = bin.location_code?.trim();
    if (code) byCode.set(code, (byCode.get(code) ?? 0) + Number(bin.available_quantity));
  }
  return [...byCode].map(([location_code, available_quantity]) => ({ location_code, available_quantity }));
}
function Fact({ label, value }: { label: string; value: string | number }) {
  return <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, py: 0.5 }}>
    <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>{label}</Typography>
    <Typography sx={{ fontSize: 12, overflowWrap: 'anywhere', textAlign: 'right' }}>{value}</Typography>
  </Box>;
}
function CostEditor({ variant, onClose }: { variant: CatalogVariant; onClose: () => void }) {
  const client = useQueryClient();
  const [value, setValue] = useState(variant.unit_cost == null ? '' : String(variant.unit_cost));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = Number(value);
  async function save() {
    if (!value.trim() || !Number.isFinite(parsed) || parsed <= 0) return;
    setPending(true); setError(null);
    try {
      await axiosInstance.patch(`/api/v1/modules/products/variants/${variant.lasyncro_variant_id}/cost`, { unit_cost: parsed });
      await Promise.all([
        client.invalidateQueries({ queryKey: ['products', 'catalog'] }),
        client.invalidateQueries({ queryKey: ['variant-costs'] }),
        client.invalidateQueries({ queryKey: ['alerts'] }),
      ]);
      onClose();
    } catch { setError('Unit cost could not be saved. Try again.'); }
    finally { setPending(false); }
  }
  return <Box sx={{ mt: 1 }}>
    <TextField label="Unit cost" type="number" size="small" value={value} disabled={pending} onChange={e => setValue(e.target.value)} inputProps={{ min: 0.01, step: 0.01 }} />
    <Button onClick={() => void save()} disabled={pending || !value.trim() || !Number.isFinite(parsed) || parsed <= 0}>{pending ? 'Saving…' : 'Save cost'}</Button>
    <Button disabled={pending} onClick={onClose}>Cancel</Button>
    {error && <Typography role="alert" sx={{ fontSize: 12 }}>{error}</Typography>}
  </Box>;
}
function LabelPrint({ variantId, enabled }: { variantId: string; enabled: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The same object-URL lifecycle as the established product label fallback.
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  async function print() {
    setPending(true); setError(null); setUrl(null);
    try {
      const { data } = await axiosInstance.post(`/api/v1/floor-planning/products/${variantId}/print`, {}, { responseType: 'blob' });
      setUrl(URL.createObjectURL(data));
    } catch { setError('Label could not be generated. Try again.'); }
    finally { setPending(false); }
  }
  return <Box sx={{ mt: 1 }}>
    <Button disabled={!enabled || pending} onClick={() => void print()}>{pending ? 'Preparing label…' : 'Print LaSyncro label'}</Button>
    {url && <><Button component="a" href={url} target="_blank" rel="noopener noreferrer">Open PDF</Button><Button component="a" href={url} download="lasyncro-label.pdf">Download</Button></>}
    {error && <Typography role="alert" sx={{ fontSize: 12 }}>{error}</Typography>}
  </Box>;
}

export function VariantDetailModalBody({ variant }: { variant: CatalogVariant }) {
  const { decide, isResolved } = useCommercialAccess();
  // Placement uses the existing floor-planning fact endpoint and its capability.
  // It does not acquire floor geometry or require the Intelligence map capability.
  const placementAllowed = isResolved && decide('warehouse.floor_planning').allowed;
  const binsQuery = useVariantWarehouseBins(variant.lasyncro_variant_id, placementAllowed);
  const bins = useMemo(() => uniqueBins(binsQuery.data?.bins ?? []), [binsQuery.data?.bins]);
  const [editingCost, setEditingCost] = useState(false);
  const section = { minWidth: 0, p: 1.75, border: '0.5px solid var(--rule)', borderRadius: '8px' };
  const heading = { fontSize: 13, fontWeight: 500, mb: 1 };
  const inventoryValue = (value: number | null | undefined) => variant.has_inventory_record ? value ?? '—' : '—';
  const costState = variant.cost_state ?? (variant.unit_cost === undefined ? 'unavailable' : variant.unit_cost === null ? 'missing' : 'present');
  return <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}>
    <Box sx={section}>
      <Typography sx={heading}>Identity</Typography>
      <Typography sx={{ fontSize: 13 }}>{variant.product_title ?? 'Unknown product'}</Typography>
      <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', mb: 1 }}>{variant.variant_title ?? 'Default variant'}</Typography>
      <Fact label="SKU" value={variant.sku || 'No SKU'} />
      <Fact label="External barcode" value={variant.barcode || '—'} />
      <Fact label="LaSyncro LSP identity" value={variant.lasyncro_barcode || '—'} />
      <Fact label="Scan identity" value={variant.scan_identity_issue === true ? 'Identity issue' : variant.scan_identity_issue === false ? 'LSP established' : 'Unavailable'} />
      <LabelPrint key={variant.lasyncro_variant_id} variantId={variant.lasyncro_variant_id} enabled={placementAllowed} />
    </Box>
    <Box sx={section}>
      <Typography sx={heading}>Inventory</Typography>
      <Fact label="On hand" value={inventoryValue(variant.on_hand_quantity)} />
      <Fact label="Available" value={inventoryValue(variant.available_quantity)} />
      {variant.reserved_quantity != null && <Fact label="Reserved" value={inventoryValue(variant.reserved_quantity)} />}
      <Fact label="Sellable" value={inventoryValue(variant.sellable_quantity)} />
      {!variant.has_inventory_record && <Typography sx={{ fontSize: 12, mt: 1 }}>Not received. No inventory record exists for this variant yet.</Typography>}
      {variant.has_inventory_record && variant.on_hand_quantity === 0 && variant.available_quantity === 0 && variant.sellable_quantity === 0 && <Typography sx={{ fontSize: 12, mt: 1 }}>Inventory exists; all current quantities are zero.</Typography>}
    </Box>
    <Box sx={section}>
      <Typography sx={heading}>Cost</Typography>
      <Fact label="Unit cost" value={costState === 'present' ? variant.unit_cost ?? '—' : costState === 'missing' ? 'Missing cost' : 'Unavailable'} />
      {editingCost ? <CostEditor key={variant.lasyncro_variant_id} variant={variant} onClose={() => setEditingCost(false)} /> : <Button onClick={() => setEditingCost(true)}>Edit cost</Button>}
    </Box>
    <Box sx={section}>
      <Typography sx={heading}>Placement</Typography>
      {!isResolved ? <Typography sx={{ fontSize: 12 }}>Placement availability is still resolving.</Typography> : !placementAllowed ?
        <Typography sx={{ fontSize: 12 }}>Placement is not available on this plan.</Typography> : binsQuery.isLoading ?
        <Typography sx={{ fontSize: 12 }}>Loading placement…</Typography> : binsQuery.isError ?
        <Typography role="alert" sx={{ fontSize: 12 }}>Warehouse location context is temporarily unavailable.</Typography> : !binsQuery.data ?
        <Typography sx={{ fontSize: 12 }}>Placement is unavailable.</Typography> : bins.length === 0 ?
        <Typography sx={{ fontSize: 12 }}>No sellable stock is currently assigned to a warehouse location.</Typography> : <>
          <Typography sx={{ fontSize: 12, mb: 1 }}>{bins.length} locations · {bins.slice(0, 2).map(b => b.location_code).join(' · ')}{bins.length > 2 ? ` · +${bins.length - 2}` : ''}</Typography>
          {bins.slice(0, 4).map(bin => <Fact key={bin.location_code} label={bin.location_code} value={`${bin.available_quantity} available`} />)}
          {bins.length > 4 && <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>+{bins.length - 4} more locations</Typography>}
        </>}
    </Box>
  </Box>;
}
