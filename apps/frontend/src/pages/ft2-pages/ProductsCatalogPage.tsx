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
import { useProductsCatalog } from '../products/useProductsCatalog';
import type { CatalogVariant } from '../products/useProductsCatalog';

interface Props {
  range: FT2DateRange;
}

export default function ProductsCatalogPage({ range }: Props) {
  const pal = useAppTheme();
  const operatorQuery = useProductsOperatorSummary(range);
  // Must be called before any early return — hooks must be called unconditionally.
  const catalogQuery = useProductsCatalog();
  if (!operatorQuery.isSuccess) {
    return <Box sx={{ p: 3 }}><Typography variant="body2" sx={{ color: pal.ink3 }}>Loading catalog…</Typography></Box>;
  }
  const { noSkuProducts, sellability, drift } = operatorQuery.data;
  const variants = catalogQuery.data?.variants ?? [];
  // Group variants by product for image grid
  const productGroups = variants.reduce<Record<string, { title: string; image_url: string | null; variants: CatalogVariant[] }>>(
    (acc, v) => {
      const key = v.lasyncro_product_id;
      if (!acc[key]) acc[key] = { title: v.product_title ?? 'Unknown', image_url: v.image_url, variants: [] };
      acc[key].variants.push(v);
      return acc;
    }, {}
  );
  const products = Object.values(productGroups);
  const added = drift.addedThisPeriod ?? 0;
  const totalProducts = (sellability.sellable ?? 0) + (sellability.blocked ?? 0);
  // Suppress drift on first sync — when added = total, it's not meaningful signal
  const showDrift = added > 0 && added < totalProducts;

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
    <Box sx={{ p: 3 }}>

      {/* ── Product list ─────────────────────────────────── */}
      {products.length > 0 && (
        <Box sx={{ ...cardSx, mb: 3 }}>
          <Box sx={{ ...headerSx, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="overline" sx={{ color: pal.ink3, fontWeight: 600 }}>
              {products.length} products · {variants.length} variants
            </Typography>
          </Box>
          {products.map((product, idx) => (
            <Box key={product.title}>
              {idx > 0 && <Divider sx={{ borderColor: pal.rule }} />}
              <Box sx={{
                px: 2, py: 1.25, display: 'flex', alignItems: 'center', gap: 2,
                '&:hover': { bgcolor: pal.rowHover }, cursor: 'pointer',
              }}>
                {/* Thumbnail */}
                <Box sx={{
                  width: 40, height: 40, borderRadius: 1, flexShrink: 0,
                  bgcolor: 'var(--bg-2)', border: `1px solid ${pal.rule}`,
                  overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {product.image_url
                    ? <img src={product.image_url} alt={product.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <Typography sx={{ fontSize: 16, fontWeight: 700, color: 'var(--ink-4)' }}>
                        {product.title.charAt(0).toUpperCase()}
                      </Typography>
                  }
                </Box>
                {/* Title */}
                <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', flex: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {product.title}
                </Typography>
                {/* Meta */}
                <Typography sx={{ fontSize: 12, color: pal.ink3, flexShrink: 0 }}>
                  {product.variants.length} variant{product.variants.length !== 1 ? 's' : ''}
                </Typography>
                <Typography sx={{ fontSize: 12, color: pal.ink3, flexShrink: 0, minWidth: 80, textAlign: 'right' }}>
                  {product.variants.reduce((s, v) => s + v.sellable_quantity, 0)} in stock
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {/* ── No-SKU products ───────────────────────────────── */}
      {/* Full list — Intelligence tab shows count only */}
      {noSkuProducts.length > 0 && (
        <Box sx={cardSx}>
          <Box sx={{ ...headerSx, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="overline" sx={{ color: pal.ink3, fontWeight: 600 }}>
              {noSkuProducts.length} products missing product code ({sellability.blockedReasons.noSku ?? 0} variants)
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
                    {p.variants.length} options: {p.variants.map(v => v.variantTitle && v.variantTitle !== 'Default Title' ? v.variantTitle : '—').join(', ')}
                  </Typography>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {/* ── Catalog drift ─────────────────────────────────── */}
      {/* Moved from Intelligence tab — setup task, not daily signal */}
      {showDrift && (
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