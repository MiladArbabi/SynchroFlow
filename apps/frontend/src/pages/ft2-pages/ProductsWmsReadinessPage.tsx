// apps/frontend/src/pages/ft2-pages/ProductsWmsReadinessPage.tsx
//
// ProductsWmsReadinessPage
// ------------------------
// Warehouse operability surface — answers: "can my warehouse
// actually pick, receive, and count this product?"
//
// DESIGN CONTRACT:
// - FT2 pattern: CSS vars only, 0.5px borders, fontWeight max 500
// - 4-card stat row at top: not pickable, no bin, variance, last eval
// - INV-04: variance_count now returns 0 (not null) when data exists
// - Read-only — never mutates
import { Box, Typography, Divider, useTheme } from '@mui/material';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { INVENTORY_MODULE_TABS } from './inventoryModuleTabs';
import { AlertTriangle, ScanBarcode, MapPin, Scale, PackageOpen } from 'lucide-react';
import { useProductsWmsReadiness } from '../products/useProductsWmsReadiness';
import { navigate } from 'runtime';

export default function ProductsWmsReadinessPage() {
  const theme = useTheme();
  const { data, isSuccess } = useProductsWmsReadiness();

  const notPickable = data?.not_pickable_count ?? null;
  const noBin       = data?.no_bin_location_count ?? null;
  const variance    = data?.variance_count ?? null;
  const varUnits    = data?.total_variance_units ?? null;
  const openReceive = data?.open_receive_jobs_with_rejections ?? null;
  const rejected    = data?.total_rejected_units ?? null;
  const oldestEval  = data?.oldest_inventory_evaluated_at ?? null;

  const formatAge = (iso: string | null): string => {
    if (!iso) return '—';
    const diffHours = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
    if (diffHours < 1)  return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.round(diffHours / 24)}d ago`;
  };

  const cardSx = {
    bgcolor: 'var(--surface)',
    border: '0.5px solid var(--rule)',
    borderRadius: '10px',
    overflow: 'hidden',
    mb: 2,
  };

  const headerSx = {
    px: 2, py: 1.25,
    borderBottom: '0.5px solid var(--rule)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  };

  if (!isSuccess) {
    return (
      <Box sx={{ p: '24px 40px' }}>
        <Typography sx={{ fontSize: 13, color: 'var(--ink-4)' }}>Loading warehouse signals…</Typography>
      </Box>
    );
  }

  return (
    <>
    <ModuleTabBar tabs={INVENTORY_MODULE_TABS} />
    <Box sx={{ p: '24px 40px', bgcolor: 'var(--bg)', minHeight: '100%' }}>
      
      {/* ── HEADER ───────────────────────────────────────────── */}
      <Box sx={{ mb: 2 }}>
        <Typography sx={{ fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1, letterSpacing: '-0.02em', mb: 0.375 }}>
          Data Quality
        </Typography>
        <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>
          Is your inventory data accurate enough to pick, receive, and count?
        </Typography>
      </Box>

      {/* ── VERDICT BANNER ───────────────────────────────────── */}
      {(() => {
        const blockers = (notPickable ?? 0) + (noBin ?? 0);
        const ready = blockers === 0;
        const tone = ready ? theme.palette.success.main : theme.palette.warning.main;
        return (
          <Box sx={{ bgcolor: 'var(--surface)', border: `0.5px solid ${tone}`, borderRadius: '10px', mb: 2.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: '18px 20px' }}>
              <Box sx={{ width: 40, height: 40, borderRadius: '10px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'var(--bg-2)', color: tone }}>
                {ready ? <PackageOpen size={20} /> : <AlertTriangle size={20} />}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 16, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.3 }}>
                  {ready ? 'Your warehouse is ready to pick' : 'Some items aren\u2019t ready to pick'}
                </Typography>
                <Typography sx={{ fontSize: 12.5, fontWeight: 300, color: 'var(--ink-3)', mt: 0.25 }}>
                  {ready
                    ? 'Every active SKU can be scanned and located.'
                    : [
                        (notPickable ?? 0) > 0 ? `${notPickable} SKU${notPickable === 1 ? '' : 's'} will fail at scan` : null,
                        (noBin ?? 0) > 0 ? `${noBin} can't be located` : null,
                      ].filter(Boolean).join(' · ')}
                  {oldestEval && ` · counts synced ${formatAge(oldestEval)}`}
                </Typography>
              </Box>
            </Box>
          </Box>
        );
      })()}

      {/* ── TWO COLUMN BODY — symmetric grid ─────────────────── */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, alignItems: 'start' }}>

        {/* LEFT — Pickability */}
        <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>

          {/* Pickability */}
          <Box sx={cardSx}>
            <Box sx={headerSx}>
              <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                Pickability — can WMS-Lite identify this product?
              </Typography>
            </Box>
            <Box sx={{ px: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, py: 1.5 }}>
                <Box sx={{ mt: 0.25, color: (notPickable ?? 0) > 0 ? theme.palette.error.main : theme.palette.success.main }}>
                  <ScanBarcode size={16} strokeWidth={2} />
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                    Not pickable — no product code
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mt: 0.25 }}>
                    Active variants with no SKU. Camera scan will fail at pick step.
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 500, color: (notPickable ?? 0) > 0 ? theme.palette.error.main : theme.palette.success.main, fontVariantNumeric: 'tabular-nums' }}>
                    {notPickable ?? '—'}
                  </Typography>
                  {(notPickable ?? 0) > 0 && (
                    <Box onClick={() => navigate('/inventory/catalog')} sx={{ display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 600, color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}>
                      Fix in Catalog →
                    </Box>
                  )}
                </Box>
              </Box>
              <Divider sx={{ borderColor: 'var(--rule)' }} />
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, py: 1.5 }}>
                <Box sx={{ mt: 0.25, color: (noBin ?? 0) > 0 ? theme.palette.warning.main : theme.palette.success.main }}>
                  <MapPin size={16} strokeWidth={2} />
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                    No bin location
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mt: 0.25 }}>
                    SKU present but not stowed in floor plan. Operator can't locate it.
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 500, color: (noBin ?? 0) > 0 ? theme.palette.warning.main : theme.palette.success.main, fontVariantNumeric: 'tabular-nums' }}>
                    {noBin ?? '—'}
                  </Typography>
                  {(noBin ?? 0) > 0 && (
                    <Box onClick={() => navigate('/floor-planning')} sx={{ display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 600, color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}>
                      Stow in Warehouse →
                    </Box>
                  )}
                </Box>
              </Box>
            </Box>
          </Box>
        </Box>

        {/* RIGHT — Trust + Receive */}
        <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>

          {/* Inventory trust */}
          <Box sx={cardSx}>
            <Box sx={headerSx}>
              <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                Inventory trust — is the stock count accurate?
              </Typography>
            </Box>
            <Box sx={{ px: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, py: 1.5 }}>
                <Box sx={{ mt: 0.25, color: variance == null ? 'var(--ink-4)' : variance > 0 ? theme.palette.warning.main : theme.palette.success.main }}>
                  <Scale size={16} strokeWidth={2} />
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                    Variants with count mismatch
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mt: 0.25 }}>
                    {variance == null
                      ? 'No cycle count run yet — run your first count to establish a baseline'
                      : varUnits != null && varUnits > 0
                        ? `${varUnits} units unaccounted for`
                        : 'Physical cycle count not yet enabled'}
                  </Typography>
                </Box>
                <Typography sx={{ fontSize: 13, fontWeight: 500, color: variance == null ? 'var(--ink-4)' : variance > 0 ? theme.palette.warning.main : theme.palette.success.main, fontVariantNumeric: 'tabular-nums' }}>
                  {variance ?? '—'}
                </Typography>
              </Box>
              <Divider sx={{ borderColor: 'var(--rule)' }} />
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, py: 1.5 }}>
                <Box sx={{ mt: 0.25, color: 'var(--ink-4)' }}>
                  <AlertTriangle size={16} strokeWidth={2} />
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                    Last inventory evaluation
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mt: 0.25 }}>
                    Oldest sync across all bin locations
                  </Typography>
                </Box>
                <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>
                  {formatAge(oldestEval)}
                </Typography>
              </Box>
            </Box>
          </Box>
        </Box>

        {/* Receive readiness */}
          <Box sx={cardSx}>
            <Box sx={headerSx}>
              <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                Receive readiness
              </Typography>
            </Box>
            <Box sx={{ px: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, py: 1.5 }}>
                <Box sx={{ mt: 0.25, color: (openReceive ?? 0) > 0 ? theme.palette.warning.main : theme.palette.success.main }}>
                  <PackageOpen size={16} strokeWidth={2} />
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                    Open receive jobs with rejections
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mt: 0.25 }}>
                    {rejected != null && rejected > 0
                      ? `${rejected} units rejected — need inspection or return to supplier`
                      : 'No rejected units in open jobs'}
                  </Typography>
                </Box>
                <Typography sx={{ fontSize: 13, fontWeight: 500, color: (openReceive ?? 0) > 0 ? theme.palette.warning.main : theme.palette.success.main, fontVariantNumeric: 'tabular-nums' }}>
                  {openReceive ?? '—'}
                </Typography>
              </Box>
            </Box>
          </Box>
        </Box>

    </Box>
  </>
  );
}