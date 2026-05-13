// apps/frontend/src/pages/ft2-pages/ProductsCatalogPage.tsx
//
// ProductsCatalogPage
// -------------------
// Full SKU catalog list — no-SKU products, catalog drift, sellability summary.
// Owns all catalog management signals — Intelligence tab shows counts only.
//
// HARD CONTRACT:
// - Read-only — never mutates
// - No intelligence/supply signals here — catalog facts only
// - Period-aware via shared range from ProductsFT2Page

import { useProductsOperatorSummary } from '../products/useProductsOperatorSummary';
import type { FT2DateRange } from '@lasyncro/ui-ft2';
import { Box, Typography, Divider } from '@mui/material';
import { useAppTheme } from 'hooks/useAppTheme';

interface Props {
  range: FT2DateRange;
}

export default function ProductsCatalogPage({ range }: Props) {
  const pal = useAppTheme();
  const operatorQuery = useProductsOperatorSummary(range);

  if (!operatorQuery.isSuccess) {
    return <Box sx={{ p: 3 }}><Typography variant="body2" sx={{ color: pal.ink3 }}>Loading catalog…</Typography></Box>;
  }

  const { noSkuProducts, sellability, drift } = operatorQuery.data;
  const added = drift.addedThisPeriod ?? 0;

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

  return (
    <Box sx={{ p: 3, maxWidth: 720 }}>

      {/* ── No-SKU products ───────────────────────────────── */}
      {/* Full list — Intelligence tab shows count only */}
      {noSkuProducts.length > 0 && (
        <Box sx={cardSx}>
          <Box sx={{ ...headerSx, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="overline" sx={{ color: pal.ink3, fontWeight: 600 }}>
              {noSkuProducts.length} products missing product code
            </Typography>
            <Typography variant="caption" sx={{ color: 'var(--mui-palette-error-main)' }}>
              WMS-Lite cannot pick these
            </Typography>
          </Box>
          <Box sx={{ px: 2, py: 1 }}>
            <Typography variant="caption" sx={{ color: pal.ink3 }}>
              Add a unique SKU in your store for each product below, then re-sync.
            </Typography>
          </Box>
          {noSkuProducts.map((p, idx) => (
            <Box key={idx}>
              {idx > 0 && <Divider sx={{ borderColor: pal.rule }} />}
              <Box sx={{
                px: 2, py: 1.25,
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                '&:hover': { bgcolor: pal.rowHover },
              }}>
                <Typography variant="body2" fontWeight={500} sx={{ color: pal.ink }}>
                  {p.productTitle ?? 'Unknown product'}
                </Typography>
                {p.variants.length > 1 && (
                  <Typography variant="caption" sx={{ color: pal.ink3, ml: 2, flexShrink: 0 }}>
                    {p.variants.length} options: {p.variants.map(v => v.variantTitle ?? '—').join(', ')}
                  </Typography>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {/* ── Catalog drift ─────────────────────────────────── */}
      {/* Moved from Intelligence tab — setup task, not daily signal */}
      {added > 0 && (
        <Box sx={cardSx}>
          <Box sx={headerSx}>
            <Typography variant="overline" sx={{ color: pal.ink3, fontWeight: 600 }}>
              Catalog drift
            </Typography>
          </Box>
          <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="h5" fontWeight={700} sx={{ color: 'var(--mui-palette-primary-main)', fontVariantNumeric: 'tabular-nums' }}>
              {added}
            </Typography>
            <Box>
              <Typography variant="body2" sx={{ color: pal.ink }}>
                {added === 1 ? 'product' : 'products'} added this period
              </Typography>
              <Typography variant="caption" sx={{ color: pal.ink3 }}>
                New to your catalog — verify SKU, cost, and bin location before selling
              </Typography>
            </Box>
          </Box>
        </Box>
      )}

      {/* ── Sellability summary ───────────────────────────── */}
      <Box sx={cardSx}>
        <Box sx={headerSx}>
          <Typography variant="overline" sx={{ color: pal.ink3, fontWeight: 600 }}>
            Sellability
          </Typography>
        </Box>
        <Box sx={{ px: 2, py: 1.5, display: 'flex', gap: 3 }}>
          <Box>
            <Typography variant="h5" fontWeight={700} sx={{ color: 'var(--mui-palette-success-main)', fontVariantNumeric: 'tabular-nums' }}>
              {sellability.sellable ?? '—'}
            </Typography>
            <Typography variant="caption" sx={{ color: pal.ink3 }}>sellable</Typography>
          </Box>
          <Box>
            <Typography variant="h5" fontWeight={700} sx={{ color: sellability.blocked ? 'var(--mui-palette-error-main)' : pal.ink, fontVariantNumeric: 'tabular-nums' }}>
              {sellability.blocked ?? '—'}
            </Typography>
            <Typography variant="caption" sx={{ color: pal.ink3 }}>blocked</Typography>
          </Box>
          {sellability.blockedReasons.noSku != null && sellability.blockedReasons.noSku > 0 && (
            <Box>
              <Typography variant="h5" fontWeight={700} sx={{ color: 'var(--mui-palette-error-main)', fontVariantNumeric: 'tabular-nums' }}>
                {sellability.blockedReasons.noSku}
              </Typography>
              <Typography variant="caption" sx={{ color: pal.ink3 }}>no SKU</Typography>
            </Box>
          )}
          {sellability.blockedReasons.zeroStock != null && sellability.blockedReasons.zeroStock > 0 && (
            <Box>
              <Typography variant="h5" fontWeight={700} sx={{ color: 'var(--mui-palette-warning-main)', fontVariantNumeric: 'tabular-nums' }}>
                {sellability.blockedReasons.zeroStock}
              </Typography>
              <Typography variant="caption" sx={{ color: pal.ink3 }}>zero stock</Typography>
            </Box>
          )}
        </Box>
      </Box>

    </Box>
  );
}