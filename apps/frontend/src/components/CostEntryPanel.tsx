// apps/frontend/src/components/CostEntryPanel.tsx
//
// CostEntryPanel
// --------------
// Inline COGS entry surface with pagination, filtering, and product images.
//
// DESIGN CONTRACT:
// - FT2 pattern: CSS vars only, 0.5px borders, fontWeight max 500
// - 10 rows per page — matches Catalog pagination pattern
// - Filter: all | missing only
// - Images from variant.image_url (variant-level, falls back to initial)
// - Both modes update variants.unit_cost + backfill oru.estimated_unit_cost
import { useState, useCallback, useRef } from 'react';
import {
  Box, Typography, TextField, Button,
  CircularProgress, Alert, Divider, InputAdornment,
} from '@mui/material';
import { Upload } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
import { useTheme } from '@mui/material/styles';

type VariantCost = {
  lasyncro_variant_id: string;
  lasyncro_product_id: string;
  title: string | null;
  sku: string | null;
  image_url: string | null;
  unit_cost: number | null;
  updated_at: string;
  product_title: string | null;
};

// ─── HOOKS ────────────────────────────────────────────────────

function useVariantCosts() {
  return useQuery<VariantCost[]>({
    queryKey: ['variant-costs'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/modules/products/variants/costs');
      return data.variants;
    },
  });
}

function usePatchVariantCost() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { variantId: string; unit_cost: number }>({
    mutationFn: async ({ variantId, unit_cost }) => {
      await axiosInstance.patch(
        `/api/v1/modules/products/variants/${variantId}/cost`,
        { unit_cost }
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['variant-costs'] });
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
}

function useBulkUpload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rows: Array<{ sku: string; unit_cost: number }>) => {
      const { data } = await axiosInstance.post(
        '/api/v1/modules/products/variants/costs/bulk',
        { rows }
      );
      return data as { updated: number; not_found: string[]; errors: string[] };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['variant-costs'] });
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
}

// ─── CSV UPLOAD ───────────────────────────────────────────────

function CsvUploadRow() {
  const fileRef = useRef<HTMLInputElement>(null);
  const { mutate: bulkUpload, isPending, data: result, reset } = useBulkUpload();
  const [parseError, setParseError] = useState<string | null>(null);

  const handleFile = useCallback((file: File) => {
    setParseError(null);
    reset();
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.trim().split('\n');
      const rows: Array<{ sku: string; unit_cost: number }> = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (i === 0 && line.toLowerCase().startsWith('sku')) continue;
        const parts = line.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
        const sku = parts[0];
        const unit_cost = parseFloat(parts[1]);
        if (!sku) { setParseError(`Row ${i + 1}: missing SKU`); return; }
        if (isNaN(unit_cost) || unit_cost <= 0) { setParseError(`Row ${i + 1}: invalid unit_cost`); return; }
        rows.push({ sku, unit_cost });
      }
      if (rows.length === 0) { setParseError('No valid rows found in CSV.'); return; }
      bulkUpload(rows);
    };
    reader.readAsText(file);
  }, [bulkUpload, reset]);

  return (
    <Box sx={{ px: 2, py: 1.5, borderBottom: '0.5px solid var(--rule)', bgcolor: 'var(--bg)', display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
      <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
        Bulk upload — CSV format: sku, unit_cost
      </Typography>
      <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
      />
      <Button size="small" variant="outlined" startIcon={isPending ? <CircularProgress size={12} /> : <Upload size={14} />}
        disabled={isPending} onClick={() => fileRef.current?.click()}
      >
        {isPending ? 'Uploading...' : 'Upload CSV'}
      </Button>
      {parseError && <Typography sx={{ fontSize: 11, color: 'error.main' }}>{parseError}</Typography>}
      {result && (
        <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
          ✓ {result.updated} updated
          {result.not_found.length > 0 && ` · ${result.not_found.length} not found`}
          {result.errors.length > 0 && ` · ${result.errors.length} errors`}
        </Typography>
      )}
    </Box>
  );
}

// ─── VARIANT ROW ──────────────────────────────────────────────

function VariantCostRow({ variant }: { variant: VariantCost }) {
  const [value, setValue] = useState(variant.unit_cost != null ? String(variant.unit_cost) : '');
  const [saved, setSaved] = useState(false);
  const { mutate, isPending, isError } = usePatchVariantCost();

  const handleSave = useCallback(() => {
    const parsed = parseFloat(value);
    if (isNaN(parsed) || parsed <= 0) return;
    mutate({ variantId: variant.lasyncro_variant_id, unit_cost: parsed }, { onSuccess: () => setSaved(true) });
  }, [value, variant.lasyncro_variant_id, mutate]);

  const rawTitle = variant.title === 'Default Title' ? null : variant.title;
  const label = rawTitle ?? variant.sku ?? variant.product_title ?? variant.lasyncro_variant_id.slice(0, 8).toUpperCase();
  const isMissing = variant.unit_cost == null || variant.unit_cost <= 0;

  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 2,
      px: 2, py: 1.25,
      borderBottom: '0.5px solid var(--rule)',
      '&:last-child': { borderBottom: 'none' },
    }}>
      {/* Thumbnail */}
      <Box sx={{ width: 36, height: 36, borderRadius: '6px', flexShrink: 0, bgcolor: 'var(--bg)', border: '0.5px solid var(--rule)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {variant.image_url
          ? <img src={variant.image_url} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-4)' }}>{label.charAt(0).toUpperCase()}</Typography>
        }
      </Box>
      {/* Label */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 500, color: isMissing ? 'var(--ink)' : 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </Typography>
        {variant.sku && variant.sku !== variant.title && (
          <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>SKU: {variant.sku}</Typography>
        )}
      </Box>
      {/* Cost input */}
      <TextField
        size="small" type="number" value={value}
        onChange={(e) => { setValue(e.target.value); setSaved(false); }}
        inputProps={{ min: 0.01, step: 0.01 }}
        sx={{ width: 120 }}
        InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
        error={isError}
        placeholder={isMissing ? 'Missing' : undefined}
      />
      {/* Save button */}
      <Button
        size="small"
        variant={saved ? 'outlined' : 'contained'}
        color={saved ? 'success' : 'primary'}
        disabled={isPending || !value || parseFloat(value) <= 0}
        onClick={handleSave}
        sx={{ minWidth: 72 }}
      >
        {isPending ? <CircularProgress size={14} /> : saved ? 'Saved ✓' : 'Save'}
      </Button>
    </Box>
  );
}

// ─── MAIN PANEL ───────────────────────────────────────────────

const PER_PAGE = 10;

export default function CostEntryPanel() {
  const theme = useTheme();
  const { data: variants, isLoading, isError } = useVariantCosts();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<'all' | 'missing'>('missing');

  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={24} /></Box>;
  if (isError) return <Alert severity="error">Failed to load product costs.</Alert>;
  if (!variants?.length) return null;

  const missingCount = variants.filter(v => v.unit_cost == null || v.unit_cost <= 0).length;
  const filtered = filter === 'missing'
    ? variants.filter(v => v.unit_cost == null || v.unit_cost <= 0)
    : variants;

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paged = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const handleFilter = (f: 'all' | 'missing') => { setFilter(f); setPage(1); };

  return (
    <Box sx={{ bgcolor: 'var(--surface)', border: '0.5px solid var(--rule)', borderRadius: '10px', overflow: 'hidden', mb: 3 }}>

      {/* Header */}
      <Box sx={{ px: 2, py: 1.5, borderBottom: '0.5px solid var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
            Product cost data missing
          </Typography>
          <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mt: 0.25 }}>
            Enter cost per unit to unlock accurate margin reporting.
          </Typography>
        </Box>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', px: 1.5, py: 0.375, borderRadius: '20px', bgcolor: theme.palette.mode === 'dark' ? 'rgba(234,179,8,0.15)' : 'rgba(234,179,8,0.1)', border: `0.5px solid rgba(234,179,8,0.35)` }}>
          <Typography sx={{ fontSize: 11, fontWeight: 500, color: theme.palette.warning.main }}>{missingCount} missing</Typography>
        </Box>
      </Box>

      {/* CSV upload */}
      <CsvUploadRow />
      <Divider sx={{ borderColor: 'var(--rule)' }} />

      {/* Filter bar */}
      <Box sx={{ px: 2, py: 1, borderBottom: '0.5px solid var(--rule)', bgcolor: 'var(--bg)', display: 'flex', alignItems: 'center', gap: 1 }}>
        {(['missing', 'all'] as const).map(f => (
          <Box
            key={f}
            onClick={() => handleFilter(f)}
            sx={{
              px: 1.5, py: 0.375, borderRadius: '20px', cursor: 'pointer',
              fontSize: 11, fontWeight: 500,
              bgcolor: filter === f ? 'var(--accent)' : 'transparent',
              color: filter === f ? '#fff' : 'var(--ink-4)',
              border: `0.5px solid ${filter === f ? 'var(--accent)' : 'var(--rule)'}`,
              '&:hover': { borderColor: 'var(--accent)' },
            }}
          >
            {f === 'missing' ? `Missing (${missingCount})` : `All (${variants.length})`}
          </Box>
        ))}
      </Box>

      {/* Variant rows */}
      {paged.map(v => <VariantCostRow key={v.lasyncro_variant_id} variant={v} />)}

      {/* Pagination footer */}
      {filtered.length > PER_PAGE && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1, bgcolor: 'var(--bg)', borderTop: '0.5px solid var(--rule)' }}>
          <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
            {((page - 1) * PER_PAGE) + 1}–{Math.min(page * PER_PAGE, filtered.length)} of {filtered.length}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box onClick={() => page > 1 && setPage(p => p - 1)} sx={{ px: 1.5, py: 0.5, borderRadius: '6px', cursor: page > 1 ? 'pointer' : 'not-allowed', border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)', fontSize: 12, color: page > 1 ? 'var(--ink-3)' : 'var(--ink-4)', opacity: page > 1 ? 1 : 0.4 }}>
              ← Prev
            </Box>
            <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', minWidth: 60, textAlign: 'center' }}>
              Page {page} of {totalPages}
            </Typography>
            <Box onClick={() => page < totalPages && setPage(p => p + 1)} sx={{ px: 1.5, py: 0.5, borderRadius: '6px', cursor: page < totalPages ? 'pointer' : 'not-allowed', border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)', fontSize: 12, color: page < totalPages ? 'var(--ink-3)' : 'var(--ink-4)', opacity: page < totalPages ? 1 : 0.4 }}>
              Next →
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}