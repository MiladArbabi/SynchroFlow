// apps/frontend/src/pages/ft2-pages/ProductsWmsReadinessPage.tsx
//
// ProductsWmsReadinessPage
// ------------------------
// Warehouse operability surface — answers: "can my warehouse
// actually pick, receive, and count this product?"
//
// HARD CONTRACT:
// - Read-only — never mutates
// - Null = no WMS activity yet, not an error
// - Uses canonical useAppTheme tokens — no hardcoded hex

import { Box, Typography, Divider } from '@mui/material';
import { AlertTriangle, ScanBarcode, MapPin, Scale, PackageOpen } from 'lucide-react';
import { useProductsWmsReadiness } from '../products/useProductsWmsReadiness';
import { useAppTheme } from 'hooks/useAppTheme';

function SignalRow({
  icon: Icon,
  label,
  value,
  sub,
  severity,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number | null;
  sub?: string;
  severity: 'ok' | 'warn' | 'critical' | 'neutral';
}) {
  const pal = useAppTheme();
  const colorMap = {
    ok:       'var(--mui-palette-success-main)',
    warn:     'var(--mui-palette-warning-main)',
    critical: 'var(--mui-palette-error-main)',
    neutral:  pal.ink3,
  };
  const color = colorMap[severity];

  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, py: 1.5 }}>
      <Box sx={{ mt: 0.25, color }}>
        <Icon size={16} strokeWidth={2} />
      </Box>
      <Box sx={{ flex: 1 }}>
        <Typography variant="body2" sx={{ color: pal.ink, fontWeight: 500 }}>
          {label}
        </Typography>
        {sub && (
          <Typography variant="caption" sx={{ color: pal.ink3 }}>
            {sub}
          </Typography>
        )}
      </Box>
      <Typography variant="body2" fontWeight={700} sx={{ color }}>
        {value ?? '—'}
      </Typography>
    </Box>
  );
}

export default function ProductsWmsReadinessPage() {
  const pal = useAppTheme();
  const { data, isSuccess } = useProductsWmsReadiness();

  const cardSx = {
    background: pal.surface,
    border: `1px solid ${pal.rule}`,
    borderRadius: 2,
    overflow: 'hidden',
    mb: 2,
  };

  const headerSx = {
    px: 2,
    py: 1.25,
    borderBottom: `1px solid ${pal.rule}`,
  };

  const notPickable = data?.not_pickable_count ?? null;
  const noBin       = data?.no_bin_location_count ?? null;
  const variance    = data?.variance_count ?? null;
  const varUnits    = data?.total_variance_units ?? null;
  const openReceive = data?.open_receive_jobs_with_rejections ?? null;
  const rejected    = data?.total_rejected_units ?? null;
  const oldestEval  = data?.oldest_inventory_evaluated_at ?? null;

  const formatDate = (iso: string | null) => {
    if (!iso) return null;
    const diffHours = Math.round((Date.now() - new Date(iso).getTime()) / 3600000);
    if (diffHours < 1)  return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.round(diffHours / 24)}d ago`;
  };

  return (
    <Box sx={{ p: 3, maxWidth: 680 }}>

      {/* ── PICKABILITY ───────────────────────────────────── */}
      <Box sx={cardSx}>
        <Box sx={headerSx}>
          <Typography variant="overline" sx={{ color: pal.ink3, fontWeight: 600 }}>
            Pickability — can WMS-Lite identify this product?
          </Typography>
        </Box>
        <Box sx={{ px: 2 }}>
          <SignalRow
            icon={ScanBarcode}
            label="Not pickable — no product code"
            sub="Active variants with no SKU. Camera scan will fail at pick step."
            value={notPickable}
            severity={notPickable == null ? 'neutral' : notPickable > 0 ? 'critical' : 'ok'}
          />
          <Divider sx={{ borderColor: pal.rule }} />
          <SignalRow
            icon={MapPin}
            label="No bin location"
            sub="SKU present but not stowed in floor plan. Operator can't locate it."
            value={noBin}
            severity={noBin == null ? 'neutral' : noBin > 0 ? 'warn' : 'ok'}
          />
        </Box>
      </Box>

      {/* ── INVENTORY TRUST ───────────────────────────────── */}
      <Box sx={cardSx}>
        <Box sx={headerSx}>
          <Typography variant="overline" sx={{ color: pal.ink3, fontWeight: 600 }}>
            Inventory trust — is the stock count accurate?
          </Typography>
        </Box>
        <Box sx={{ px: 2 }}>
          <SignalRow
            icon={Scale}
            label="Variants with count mismatch"
            sub={varUnits != null ? `${varUnits} units unaccounted for` : 'On-hand vs available delta'}
            value={variance}
            severity={variance == null ? 'neutral' : variance > 0 ? 'warn' : 'ok'}
          />
          <Divider sx={{ borderColor: pal.rule }} />
          <SignalRow
            icon={AlertTriangle}
            label="Last inventory evaluation"
            sub="Oldest sync across all bin locations"
            value={formatDate(oldestEval)}
            severity={oldestEval == null ? 'neutral' : 'ok'}
          />
        </Box>
      </Box>

      {/* ── RECEIVE READINESS ─────────────────────────────── */}
      <Box sx={cardSx}>
        <Box sx={headerSx}>
          <Typography variant="overline" sx={{ color: pal.ink3, fontWeight: 600 }}>
            Receive readiness — inbound jobs needing attention
          </Typography>
        </Box>
        <Box sx={{ px: 2 }}>
          <SignalRow
            icon={PackageOpen}
            label="Open receive jobs with rejections"
            sub={rejected != null ? `${rejected} units rejected — need inspection or return to supplier` : undefined}
            value={openReceive}
            severity={openReceive == null ? 'neutral' : openReceive > 0 ? 'warn' : 'ok'}
          />
        </Box>
      </Box>

      {!isSuccess && !data && (
        <Box sx={{ p: 3 }}>
          <Typography variant="body2" sx={{ color: pal.ink3 }}>
            Loading warehouse signals…
          </Typography>
        </Box>
      )}
    </Box>
  );
}