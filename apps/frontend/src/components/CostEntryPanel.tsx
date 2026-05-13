// apps/frontend/src/components/CostEntryPanel.tsx
import { useState, useCallback, useRef } from 'react';
import {
  Box, Typography, TextField, Button, Chip,
  CircularProgress, Alert, Divider, InputAdornment,
} from '@mui/material';
import { Upload } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

/**
 * COST ENTRY PANEL (PP4-04, PP9b-01)
 * ------------------------------------
 * Inline COGS entry surface — shown when missing_cogs alert is active.
 *
 * Two entry modes:
 * 1. CSV bulk upload — sku, unit_cost columns
 * 2. Per-variant inline editor
 *
 * Both modes:
 * - Update variants.unit_cost (future orders)
 * - Backfill order_revenue_units.estimated_unit_cost for unfulfilled orders
 * - Invalidate alerts query so missing_cogs alert resolves without refresh
 */

type VariantCost = {
  lasyncro_variant_id: string;
  title: string | null;
  sku: string | null;
  unit_cost: number | null;
  updated_at: string;
  product_title: string | null;
};

// ─────────────────────────────────────────
// HOOKS
// ─────────────────────────────────────────

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
// ─────────────────────────────────────────
// CSV UPLOAD SECTION
// ─────────────────────────────────────────

/**
 * CSV UPLOAD ROW (PP9b-01)
 * ------------------------
 * Accepts a CSV file with columns: sku, unit_cost
 * Parses client-side, sends parsed rows to bulk endpoint.
 * Shows per-upload result summary inline.
 *
 * CSV format:
 *   sku,unit_cost
 *   BLUE-TEE-M,12.50
 *   RED-HAT-L,8.00
 */
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
        // Skip header row if present
        if (i === 0 && line.toLowerCase().startsWith('sku')) continue;

        const parts = line.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
        const sku = parts[0];
        const costStr = parts[1];
        const unit_cost = parseFloat(costStr);

        if (!sku) { setParseError(`Row ${i + 1}: missing SKU`); return; }
        if (isNaN(unit_cost) || unit_cost <= 0) {
          setParseError(`Row ${i + 1}: invalid unit_cost "${costStr ?? ''}"`);
          return;
        }
        rows.push({ sku, unit_cost });
      }

      if (rows.length === 0) { setParseError('No valid rows found in CSV.'); return; }
      bulkUpload(rows);
    };
    reader.readAsText(file);
  }, [bulkUpload, reset]);

  return (
    <Box sx={{
      px: 2, py: 1.5,
      borderBottom: '1px solid', borderColor: 'divider',
      bgcolor: 'action.hover',
    }}>
      <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        BULK UPLOAD — CSV format: sku, unit_cost
      </Typography>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = '';
        }}
      />
      <Button
        size="small"
        variant="outlined"
        startIcon={isPending ? <CircularProgress size={12} /> : <Upload size={14} />}
        disabled={isPending}
        onClick={() => fileRef.current?.click()}
      >
        {isPending ? 'Uploading...' : 'Upload CSV'}
      </Button>

      {parseError && (
        <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.75 }}>
          {parseError}
        </Typography>
      )}

      {result && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
          ✓ {result.updated} updated
          {result.not_found.length > 0 && ` · ${result.not_found.length} SKU${result.not_found.length > 1 ? 's' : ''} not found`}
          {result.errors.length > 0 && ` · ${result.errors.length} error${result.errors.length > 1 ? 's' : ''}`}
        </Typography>
      )}
    </Box>
  );
}

// ─────────────────────────────────────────
// PER-VARIANT ROW
// ─────────────────────────────────────────

function VariantCostRow({ variant }: { variant: VariantCost }) {
  const [value, setValue] = useState(
    variant.unit_cost != null ? String(variant.unit_cost) : ''
  );
  const [saved, setSaved] = useState(false);
  const { mutate, isPending, isError } = usePatchVariantCost();

  const handleSave = useCallback(() => {
    const parsed = parseFloat(value);
    if (isNaN(parsed) || parsed <= 0) return;
    mutate(
      { variantId: variant.lasyncro_variant_id, unit_cost: parsed },
      { onSuccess: () => setSaved(true) }
    );
  }, [value, variant.lasyncro_variant_id, mutate]);

  // Suppress Shopify's "Default Title" placeholder — not meaningful to operators
  const rawTitle = variant.title === 'Default Title' ? null : variant.title;
  // For variants with no meaningful title, show product name as context
  const label = rawTitle ?? variant.sku ?? variant.product_title ?? variant.lasyncro_variant_id.slice(0, 8).toUpperCase();
  const isMissing = variant.unit_cost == null || variant.unit_cost <= 0;

  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: '1fr auto auto',
      gap: 1.5,
      alignItems: 'center',
      px: 2,
      py: 1.5,
      borderBottom: '1px solid',
      borderColor: 'divider',
      '&:last-child': { borderBottom: 'none' },
    }}>
      <Box>
        <Typography variant="body2" fontWeight={600}>{label}</Typography>
        {variant.sku && variant.sku !== variant.title && (
          <Typography variant="caption" color="text.secondary">SKU: {variant.sku}</Typography>
        )}
      </Box>
      <TextField
        size="small"
        type="number"
        value={value}
        onChange={(e) => { setValue(e.target.value); setSaved(false); }}
        inputProps={{ min: 0.01, step: 0.01 }}
        sx={{ width: 120 }}
        InputProps={{
          startAdornment: <InputAdornment position="start">$</InputAdornment>,
        }}
        error={isError}
        placeholder={isMissing ? 'Missing' : undefined}
      />
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

// ─────────────────────────────────────────
// MAIN PANEL
// ─────────────────────────────────────────

export default function CostEntryPanel() {
  const { data: variants, isLoading, isError } = useVariantCosts();

  const missingCount = (variants ?? []).filter(
    (v) => v.unit_cost == null || v.unit_cost <= 0
  ).length;

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (isError) {
    return <Alert severity="error">Failed to load product costs.</Alert>;
  }

  if (!variants?.length || missingCount === 0) return null;

  return (
    <Box sx={{ mb: 3, border: '1px solid', borderColor: 'warning.light', borderRadius: 2, overflow: 'hidden' }}>

      {/* HEADER */}
      <Box sx={{
        px: 2, py: 1.5,
        borderBottom: '1px solid', borderColor: 'warning.light',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Box>
          <Typography variant="body2" fontWeight={700}>
            Product cost data missing
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Enter cost per unit to unlock accurate margin reporting.
          </Typography>
        </Box>
        <Chip label={`${missingCount} missing`} size="small" color="warning" />
      </Box>

      {/* BULK CSV UPLOAD */}
      <CsvUploadRow />

      <Divider />

      {/* PER-VARIANT ROWS — missing first, then with cost */}
      {variants.map((v) => (
        <VariantCostRow key={v.lasyncro_variant_id} variant={v} />
      ))}

    </Box>
  );
}