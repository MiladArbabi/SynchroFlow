// Canonical Items ledger. The legacy filename remains an import compatibility boundary.
import { useEffect, useState } from 'react';
import { Box, Button, Typography, TextField, Menu, MenuItem, Dialog, DialogTitle, DialogContent } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import useConfig from 'hooks/useConfig';
import { OperationalContextShell } from '@lasyncro/shared/ui';
import type { FT2DateRange } from '@lasyncro/ui-ft2';
import { useProductsCatalog, type CatalogVariant } from '../products/useProductsCatalog';
import { VariantDetailModalHost } from './VariantDetailModalHost';
import { CsvUploadRow } from '../../components/CostEntryPanel';

export function itemCostState(item: CatalogVariant) {
  return item.cost_state ?? (item.unit_cost === undefined ? 'unavailable' : item.unit_cost === null || item.unit_cost <= 0 ? 'missing' : 'present');
}
export function itemSignals(item: CatalogVariant): string[] {
  return [!item.sku?.trim() && 'Missing SKU', item.scan_identity_issue && 'Identity issue',
    itemCostState(item) === 'missing' && 'Missing cost', !item.has_inventory_record && 'Not received']
    .filter((value): value is string => Boolean(value));
}
const panel = { border: '0.5px solid var(--rule)', borderRadius: '10px', bgcolor: 'var(--surface)', minWidth: 0 };
const control = { fontFamily: 'inherit', fontSize: 12, textTransform: 'none' as const, color: 'var(--ink-2)' };

export default function ProductsCatalogPage(_props: { range: FT2DateRange; onChange: (range: FT2DateRange) => void }) {
  const { state: { isOpsConsoleOpen } } = useConfig();
  const query = useProductsCatalog();
  const [params, setParams] = useSearchParams();
  const [bulkAnchor, setBulkAnchor] = useState<HTMLElement | null>(null);
  const [filtersAnchor, setFiltersAnchor] = useState<HTMLElement | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const variants = query.data?.variants ?? [];
  const variantId = params.get('variant');
  const search = params.get('search') ?? '';
  const filter = params.get('filter') ?? 'all';
  const update = (key: string, value: string, resetPage = false) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (resetPage) next.delete('page');
    setParams(next, { replace: true });
  };
  const closeDetail = () => update('variant', '');
  useEffect(() => {
    if (variantId && query.isSuccess && !variants.some(v => v.lasyncro_variant_id === variantId)) {
      const next = new URLSearchParams(params); next.delete('variant'); setParams(next, { replace: true });
    }
  }, [variantId, query.isSuccess, query.data, params, setParams]);
  const matchesFilter = (item: CatalogVariant) => {
    if (filter === 'missing-cost') return itemCostState(item) === 'missing';
    if (filter === 'not-received') return !item.has_inventory_record;
    if (filter === 'missing-sku') return !item.sku?.trim();
    if (filter === 'identity-issues') return item.scan_identity_issue === true;
    return true;
  };
  const filtered = variants.filter(v => matchesFilter(v) &&
    [v.product_title, v.variant_title, v.sku, v.barcode, v.lasyncro_barcode].some(value => value?.toLowerCase().includes(search.toLowerCase())));
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const requestedPage = Number(params.get('page'));
  const page = Math.min(pages, Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1));
  const choices = [['all', 'All'], ['identity-issues', 'Identity issues'], ['missing-cost', 'Missing cost'], ['not-received', 'Not received'], ['missing-sku', 'Missing SKU']];
  // Inventory / Shipping state anatomy; retain domain grouping rather than
  // PulseCard's severity sorting. Rows only filter the existing ledger.
  const stateGroups = [
    { label: 'Items', rows: [
      { label: 'Items', value: variants.length, selection: 'all' },
      { label: 'Products', value: new Set(variants.map(v => v.lasyncro_product_id)).size, selection: 'all' },
    ] },
    { label: 'Identity', rows: [
      { label: 'Scan identity issues', value: variants.filter(v => v.scan_identity_issue === true).length, selection: 'identity-issues' },
      { label: 'Missing SKU', value: variants.filter(v => !v.sku?.trim()).length, selection: 'missing-sku' },
    ] },
    { label: 'Setup', rows: [
      { label: 'Missing cost', value: variants.filter(v => itemCostState(v) === 'missing').length, selection: 'missing-cost' },
      { label: 'Not received', value: variants.filter(v => !v.has_inventory_record).length, selection: 'not-received' },
    ] },
  ];
  return <>
    <Box sx={{ p: { xs: 2, md: '24px 32px' }, bgcolor: 'var(--bg)', minWidth: 0 }}>
      <Typography sx={{ fontSize: 22, fontWeight: 500, mb: 2 }}>Items</Typography>
      <OperationalContextShell suppressRail={isOpsConsoleOpen} primary={
        <Box role="region" aria-label="Items ledger" sx={{ ...panel, height: { md: 'min(680px, calc(100dvh - 220px))' }, minHeight: 360, display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ display: 'flex', gap: 1, p: 1.5 }}>
            <TextField size="small" placeholder="Search item, SKU, barcode…" inputProps={{ 'aria-label': 'Search item, SKU, barcode' }} value={search} onChange={e => update('search', e.target.value, true)} sx={{ flex: 1, minWidth: 0 }} />
            <Button sx={control} onClick={e => setFiltersAnchor(e.currentTarget)}>Filters</Button>
            <Button sx={control} onClick={e => setBulkAnchor(e.currentTarget)}>Bulk ▾</Button>
          </Box>
          <Menu anchorEl={filtersAnchor} open={Boolean(filtersAnchor)} onClose={() => setFiltersAnchor(null)}>
            {choices.map(([key, label]) => <MenuItem key={key} selected={filter === key} onClick={() => { update('filter', key, true); setFiltersAnchor(null); }}>{label}</MenuItem>)}
          </Menu>
          <Menu anchorEl={bulkAnchor} open={Boolean(bulkAnchor)} onClose={() => setBulkAnchor(null)}>
            <MenuItem onClick={() => { setBulkAnchor(null); setImportOpen(true); }}>Import costs CSV</MenuItem>
          </Menu>
          <Box role="group" aria-label="Item filters" sx={{ px: 1.5, pb: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {choices.filter(([key]) => key !== 'missing-cost' && key !== 'missing-sku').map(([key, label]) => <Box component="button" type="button" key={key} sx={{
              px: 1.5, py: 0.625, borderRadius: '6px', cursor: 'pointer',
              fontSize: 12, fontWeight: 500, fontFamily: 'inherit',
              bgcolor: filter === key ? 'var(--accent)' : 'var(--surface)',
              color: filter === key ? 'var(--accent-ink)' : 'var(--ink-3)',
              border: '1px solid', borderColor: filter === key ? 'var(--accent)' : 'var(--rule)',
              transition: 'background-color 0.12s',
              '&:hover': { bgcolor: filter === key ? 'var(--accent-hover)' : 'var(--bg-3)' },
              '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '2px' },
            }} aria-pressed={filter === key} onClick={() => update('filter', key, true)}>{label}</Box>)}
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            {query.isLoading ? <Typography sx={{ p: 2 }}>Loading catalog…</Typography> : query.isError ?
              <Box sx={{ p: 2 }}><Typography role="alert">Items are temporarily unavailable.</Typography><Button onClick={() => void query.refetch()}>Retry</Button></Box> :
              <Box component="table" sx={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 12, '& th, & td': { p: '10px 8px', textAlign: 'left', overflowWrap: 'anywhere', borderBottom: '0.5px solid var(--rule)' }, '& th': { fontWeight: 500, color: 'var(--ink-3)', bgcolor: 'var(--surface)', position: 'sticky', top: 0 } }}>
                <colgroup><col style={{ width: '25%' }} /><col style={{ width: '23%' }} /><col style={{ width: '11%' }} /><col style={{ width: '11%' }} /><col style={{ width: '13%' }} /><col style={{ width: '17%' }} /></colgroup>
                <thead><tr>{['Item', 'Identity', 'On hand', 'Available', 'Unit cost', 'Signal'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
                <tbody>{filtered.slice((page - 1) * 10, page * 10).map(v => <tr key={v.lasyncro_variant_id}>
                  <td><Button sx={{ ...control, p: 0, textAlign: 'left', display: 'flex', gap: 1, justifyContent: 'flex-start', width: '100%' }} onClick={() => update('variant', v.lasyncro_variant_id)}>
                    {v.image_url && <img src={v.image_url} alt="" width={28} height={28} style={{ objectFit: 'cover', borderRadius: 4 }} />}
                    <span><span style={{ display: 'block' }}>{v.variant_title && v.variant_title !== 'Default Title' ? v.variant_title : v.product_title ?? 'Unknown item'}</span><span style={{ display: 'block', fontSize: 11, color: 'var(--ink-4)' }}>{v.product_title}</span></span>
                  </Button></td>
                  <td>{v.sku || 'No SKU'}<Typography sx={{ fontSize: 10, color: 'var(--ink-4)' }}>{[v.barcode, v.lasyncro_barcode].filter(Boolean).join(' · ')}</Typography></td>
                  <td>{v.has_inventory_record ? v.on_hand_quantity ?? '—' : '—'}</td><td>{v.has_inventory_record ? v.available_quantity ?? '—' : '—'}</td>
                  <td>{itemCostState(v) === 'present' ? v.unit_cost : itemCostState(v) === 'missing' ? 'Missing' : '—'}</td><td><Box component="span" sx={{ fontSize: 12, color: itemSignals(v).length ? 'var(--warning-ink)' : 'var(--ink-4)' }}>{itemSignals(v).join(' · ') || '—'}</Box></td>
                </tr>)}</tbody>
              </Box>}
            {query.isSuccess && !filtered.length && <Typography sx={{ p: 2 }}>No matching items.</Typography>}
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 1, borderTop: '0.5px solid var(--rule)' }}>
            <Button sx={control} disabled={page <= 1} onClick={() => update('page', String(page - 1))}>Previous</Button>
            <Typography sx={{ fontSize: 11 }}>{page} / {pages} · {filtered.length} items</Typography>
            <Button sx={control} disabled={page >= pages} onClick={() => update('page', String(page + 1))}>Next</Button>
          </Box>
        </Box>
      } rail={
        <Box component="aside" aria-label="Item state" sx={{
          minWidth: 0, boxSizing: 'border-box', bgcolor: 'var(--surface)',
          border: '0.5px solid var(--rule)', borderRadius: '14px', px: '18px', py: '14px',
          display: 'flex', flexDirection: 'column', height: { lg: '100%' },
        }}>
          <Typography component="h2" sx={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', lineHeight: 1, mb: '12px' }}>Item state</Typography>
          {stateGroups.map(group => <Box key={group.label} role="group" aria-label={group.label} sx={{
            display: 'flex', flexDirection: 'column', gap: '6px', py: '10px',
            borderTop: '0.5px solid var(--rule)', '&:first-of-type': { borderTop: 'none', pt: 0 },
          }}>
            <Typography component="span" sx={{ display: 'block', fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: '2px' }}>{group.label}</Typography>
            {group.rows.map(row => <Box component="button" type="button" key={row.label} onClick={() => update('filter', row.selection, true)} sx={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1,
              p: 0, border: 'none', bgcolor: 'transparent', fontFamily: 'inherit', textAlign: 'left',
              py: 0.5, px: 1, mx: -1, borderRadius: '6px', cursor: 'pointer',
              transition: 'background-color 0.12s', '&:hover': { bgcolor: 'var(--bg-3)' },
              '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '2px' },
            }}>
              <Typography component="span" sx={{ fontSize: 12.5, fontWeight: 400, lineHeight: 1.45, color: 'var(--ink-3)' }}>{row.label}</Typography>
              <Typography component="span" sx={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.45, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
                color: !query.isSuccess || group.label === 'Items' ? 'var(--ink)' : row.value > 0 ? 'var(--warning-ink)' : 'var(--good-ink)',
              }}>{query.isSuccess ? row.value : '—'}</Typography>
            </Box>)}
          </Box>)}
        </Box>
      } />
    </Box>
    <Dialog open={importOpen} onClose={() => setImportOpen(false)} maxWidth="sm" fullWidth><DialogTitle>Import costs CSV</DialogTitle><DialogContent>{importOpen && <CsvUploadRow />}<Button onClick={() => setImportOpen(false)}>Close</Button></DialogContent></Dialog>
    <VariantDetailModalHost variantId={variantId} onClose={closeDetail} />
  </>;
}
