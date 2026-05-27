// apps/frontend/src/pages/ft2-pages/ProductsCatalogPage.tsx
//
// ProductsCatalogPage
// -------------------
// Full SKU catalog — sellability stat cards, two-column layout:
//   LEFT:  product list with per-row actions
//   RIGHT: no-SKU section + catalog drift
//
// DESIGN CONTRACT:
// - FT2 pattern: CSS vars only, 0.5px borders, fontWeight max 500
// - Gift card filtered at backend (INV-05)
// - Per-row CTAs: zero stock → Reorder, no image → fix signal only
// - Read-only — never mutates
import { useState } from 'react';
import { useProductsOperatorSummary } from '../products/useProductsOperatorSummary';
import type { FT2DateRange } from '@lasyncro/ui-ft2';
import { Box, Typography, Divider, useTheme } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useProductsCatalog } from '../products/useProductsCatalog';
import type { CatalogVariant } from '../products/useProductsCatalog';

interface Props {
  range: FT2DateRange;
}

export default function ProductsCatalogPage({ range }: Props) {
  const theme = useTheme();
  const navigate = useNavigate();
  const operatorQuery = useProductsOperatorSummary(range);
  const catalogQuery = useProductsCatalog();

  // ── Pagination + sort state ───────────────────────────────
  const [page, setPage] = useState(1);
  const PER_PAGE = 10;
  type SortField = 'title' | 'stock' | 'variants';
  type SortDir = 'asc' | 'desc';
  const [sortField, setSortField] = useState<SortField>('title');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [noSkuPage, setNoSkuPage] = useState(1);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
    setPage(1);
  };

  if (!operatorQuery.isSuccess || catalogQuery.isLoading) {
    return <Box sx={{ p: '24px 40px' }}><Typography sx={{ fontSize: 13, color: 'var(--ink-4)' }}>Loading catalog…</Typography></Box>;
  }

  const { noSkuProducts, sellability, drift } = operatorQuery.data;
  const variants = catalogQuery.data?.variants ?? [];

  // Group variants by product
  const productGroups = variants.reduce<Record<string, {
    title: string;
    image_url: string | null;
    variants: CatalogVariant[];
  }>>((acc, v) => {
    const key = v.lasyncro_product_id;
    if (!acc[key]) acc[key] = { title: v.product_title ?? 'Unknown', image_url: v.image_url, variants: [] };
    acc[key].variants.push(v);
    return acc;
  }, {});

  // Sort products
  const allProducts = Object.values(productGroups).sort((a, b) => {
    const mul = sortDir === 'asc' ? 1 : -1;
    if (sortField === 'title') return mul * a.title.localeCompare(b.title);
    if (sortField === 'stock') {
      const aStock = a.variants.reduce((s, v) => s + v.sellable_quantity, 0);
      const bStock = b.variants.reduce((s, v) => s + v.sellable_quantity, 0);
      return mul * (aStock - bStock);
    }
    if (sortField === 'variants') return mul * (a.variants.length - b.variants.length);
    return 0;
  });

  const totalPages = Math.ceil(allProducts.length / PER_PAGE);
  const products = allProducts.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // Image lookup: product title → image_url from catalog variants
  const titleToImage = Object.values(productGroups).reduce<Record<string, string | null>>(
    (acc, p) => { acc[p.title] = p.image_url; return acc; }, {}
  );

  // No-SKU pagination
  const noSkuTotalPages = Math.ceil(noSkuProducts.length / PER_PAGE);
  const pagedNoSkuProducts = noSkuProducts.slice((noSkuPage - 1) * PER_PAGE, noSkuPage * PER_PAGE);

  const totalProducts = (sellability.sellable ?? 0) + (sellability.blocked ?? 0);
  const added = drift.addedThisPeriod ?? 0;
  const showDrift = added > 0 && added < totalProducts;

  const cardSx = {
    bgcolor: 'var(--surface)',
    border: '0.5px solid var(--rule)',
    borderRadius: '10px',
    overflow: 'hidden',
  };

  const headerSx = {
    px: 2,
    py: 1.25,
    borderBottom: '0.5px solid var(--rule)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  };

  return (
    <Box sx={{ p: '24px 40px', bgcolor: 'var(--bg)', minHeight: '100%' }}>

      {/* ── HEADER ───────────────────────────────────────────── */}
      <Box sx={{ mb: 2.5 }}>
        <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2, mb: 0.25 }}>
          Catalog
        </Typography>
        <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>
          {products.length} products · {variants.length} variants
          {noSkuProducts.length > 0 && ` · ${noSkuProducts.length} missing product code`}
        </Typography>
      </Box>

      {/* ── STAT ROW — 4 cards ───────────────────────────────── */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1.5, mb: 3 }}>
        <Box sx={{ bgcolor: 'var(--surface)', border: '0.5px solid var(--rule)', borderRadius: '8px', p: '12px 14px' }}>
          <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.5 }}>Sellable</Typography>
          <Typography sx={{ fontSize: 24, fontWeight: 500, color: theme.palette.success.main, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
            {sellability.sellable ?? '—'}
          </Typography>
        </Box>
        <Box sx={{ bgcolor: 'var(--surface)', border: '0.5px solid var(--rule)', borderRadius: '8px', p: '12px 14px' }}>
          <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.5 }}>Blocked</Typography>
          <Typography sx={{ fontSize: 24, fontWeight: 500, color: (sellability.blocked ?? 0) > 0 ? theme.palette.error.main : 'var(--ink)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
            {sellability.blocked ?? '—'}
          </Typography>
        </Box>
        <Box sx={{ bgcolor: 'var(--surface)', border: '0.5px solid var(--rule)', borderRadius: '8px', p: '12px 14px' }}>
          <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.5 }}>No SKU</Typography>
          <Typography sx={{ fontSize: 24, fontWeight: 500, color: (sellability.blockedReasons.noSku ?? 0) > 0 ? theme.palette.error.main : 'var(--ink)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
            {sellability.blockedReasons.noSku ?? '—'}
          </Typography>
          {(sellability.blockedReasons.noSku ?? 0) > 0 && (
            <Typography
              onClick={() => { document.getElementById('no-sku-section')?.scrollIntoView({ behavior: 'smooth' }); }}
              sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', mt: 0.5, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
            >
              Fix below →
            </Typography>
          )}
        </Box>
        <Box sx={{ bgcolor: 'var(--surface)', border: '0.5px solid var(--rule)', borderRadius: '8px', p: '12px 14px' }}>
          <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.5 }}>Zero stock</Typography>
          <Typography sx={{ fontSize: 24, fontWeight: 500, color: (sellability.blockedReasons.zeroStock ?? 0) > 0 ? theme.palette.warning.main : 'var(--ink)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
            {sellability.blockedReasons.zeroStock ?? '—'}
          </Typography>
          {(sellability.blockedReasons.zeroStock ?? 0) > 0 && (
            <Typography
              onClick={() => navigate('/demand')}
              sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', mt: 0.5, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
            >
              See Demand →
            </Typography>
          )}
        </Box>
      </Box>

      {/* ── TWO COLUMN BODY ──────────────────────────────────── */}
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>

        {/* LEFT — Product list */}
        <Box sx={{ flex: 2, minWidth: 320 }}>
          {products.length > 0 && (
            <Box sx={cardSx}>
              {/* ── Column headers ── */}
              <Box sx={{ ...headerSx, bgcolor: 'var(--bg)' }}>
                <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                  {allProducts.length} products · {variants.length} variants
                </Typography>
                <Box sx={{ display: 'flex', gap: 2 }}>
                  {(['title', 'variants', 'stock'] as const).map(f => (
                    <Typography
                      key={f}
                      onClick={() => handleSort(f)}
                      sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: sortField === f ? 'var(--accent)' : 'var(--ink-4)', cursor: 'pointer', '&:hover': { color: 'var(--accent)' } }}
                    >
                      {f}{sortField === f ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                    </Typography>
                  ))}
                </Box>
              </Box>

              {/* ── Product rows ── */}
              {products.map((product, idx) => {
                const totalStock = product.variants.reduce((s, v) => s + v.sellable_quantity, 0);
                const hasNoSku = product.variants.some(v => !v.sku);
                const isZeroStock = totalStock === 0;
                return (
                  <Box key={product.title}>
                    {idx > 0 && <Divider sx={{ borderColor: 'var(--rule)' }} />}
                    <Box sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'center', gap: 2, '&:hover': { bgcolor: 'action.hover' }, cursor: 'pointer' }}>
                      <Box sx={{ width: 36, height: 36, borderRadius: '6px', flexShrink: 0, bgcolor: 'var(--bg)', border: '0.5px solid var(--rule)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {product.image_url
                          ? <img src={product.image_url} alt={product.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'var(--ink-4)' }}>{product.title.charAt(0).toUpperCase()}</Typography>
                        }
                      </Box>
                      <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {product.title}
                      </Typography>
                      <Typography sx={{ fontSize: 12, color: 'var(--ink-4)', flexShrink: 0 }}>
                        {product.variants.length} variant{product.variants.length !== 1 ? 's' : ''}
                      </Typography>
                      <Typography sx={{ fontSize: 12, flexShrink: 0, minWidth: 72, textAlign: 'right', color: isZeroStock ? theme.palette.error.main : 'var(--ink-4)', fontWeight: isZeroStock ? 500 : 400 }}>
                        {totalStock} in stock
                      </Typography>
                      {hasNoSku && (
                        <Typography sx={{ fontSize: 11, fontWeight: 500, color: theme.palette.error.main, flexShrink: 0, minWidth: 80, textAlign: 'right' }}>No SKU</Typography>
                      )}
                      {!hasNoSku && isZeroStock && (
                        <Typography onClick={(e) => { e.stopPropagation(); navigate('/suppliers'); }} sx={{ fontSize: 11, fontWeight: 500, color: 'var(--accent)', cursor: 'pointer', flexShrink: 0, minWidth: 80, textAlign: 'right', '&:hover': { textDecoration: 'underline' } }}>Reorder →</Typography>
                      )}
                      {!hasNoSku && !isZeroStock && <Box sx={{ minWidth: 80 }} />}
                    </Box>
                  </Box>
                );
              })}

              {/* ── Pagination footer ── */}
              {allProducts.length > PER_PAGE && (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1, bgcolor: 'var(--bg)', borderTop: '0.5px solid var(--rule)' }}>
                  <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
                    {((page - 1) * PER_PAGE) + 1}–{Math.min(page * PER_PAGE, allProducts.length)} of {allProducts.length} products
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
          )}
        </Box>

        {/* RIGHT — No-SKU section + Catalog drift */}
        <Box sx={{ flex: 1, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 2 }}>

          {noSkuProducts.length > 0 && (
            <Box id="no-sku-section" sx={cardSx}>
              {/* Header */}
              <Box sx={{ ...headerSx, bgcolor: 'var(--bg)' }}>
                <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                  {noSkuProducts.length} missing product code
                </Typography>
                <Typography sx={{ fontSize: 11, fontWeight: 500, color: theme.palette.error.main }}>
                  WMS can't pick
                </Typography>
              </Box>
              <Box sx={{ px: 2, py: 1, borderBottom: '0.5px solid var(--rule)' }}>
                <Typography sx={{ fontSize: 12, color: 'var(--ink-4)' }}>
                  Add a unique SKU in Shopify, then re-sync.
                </Typography>
              </Box>
              {/* Rows with images */}
              {pagedNoSkuProducts.map((p, idx) => {
                const imgUrl = titleToImage[p.productTitle ?? ''] ?? null;
                return (
                  <Box key={idx}>
                    {idx > 0 && <Divider sx={{ borderColor: 'var(--rule)' }} />}
                    <Box sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'center', gap: 2, '&:hover': { bgcolor: 'action.hover' } }}>
                      {/* Thumbnail */}
                      <Box sx={{ width: 36, height: 36, borderRadius: '6px', flexShrink: 0, bgcolor: 'var(--bg)', border: '0.5px solid var(--rule)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {imgUrl
                          ? <img src={imgUrl} alt={p.productTitle ?? ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'var(--ink-4)' }}>
                              {(p.productTitle ?? '?').charAt(0).toUpperCase()}
                            </Typography>
                        }
                      </Box>
                      <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.productTitle ?? 'Unknown product'}
                      </Typography>
                      {p.variants.length > 1 && (
                        <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', flexShrink: 0 }}>
                          {p.variants.length} options
                        </Typography>
                      )}
                    </Box>
                  </Box>
                );
              })}
              {/* Pagination footer */}
              {noSkuProducts.length > PER_PAGE && (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1, bgcolor: 'var(--bg)', borderTop: '0.5px solid var(--rule)' }}>
                  <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
                    {((noSkuPage - 1) * PER_PAGE) + 1}–{Math.min(noSkuPage * PER_PAGE, noSkuProducts.length)} of {noSkuProducts.length}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box onClick={() => noSkuPage > 1 && setNoSkuPage(p => p - 1)} sx={{ px: 1.5, py: 0.5, borderRadius: '6px', cursor: noSkuPage > 1 ? 'pointer' : 'not-allowed', border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)', fontSize: 12, color: noSkuPage > 1 ? 'var(--ink-3)' : 'var(--ink-4)', opacity: noSkuPage > 1 ? 1 : 0.4 }}>
                      ← Prev
                    </Box>
                    <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', minWidth: 60, textAlign: 'center' }}>
                      Page {noSkuPage} of {noSkuTotalPages}
                    </Typography>
                    <Box onClick={() => noSkuPage < noSkuTotalPages && setNoSkuPage(p => p + 1)} sx={{ px: 1.5, py: 0.5, borderRadius: '6px', cursor: noSkuPage < noSkuTotalPages ? 'pointer' : 'not-allowed', border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)', fontSize: 12, color: noSkuPage < noSkuTotalPages ? 'var(--ink-3)' : 'var(--ink-4)', opacity: noSkuPage < noSkuTotalPages ? 1 : 0.4 }}>
                      Next →
                    </Box>
                  </Box>
                </Box>
              )}
            </Box>
          )}

          {/* Catalog drift */}
          {showDrift && (
            <Box sx={cardSx}>
              <Box sx={headerSx}>
                <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                  Catalog drift
                </Typography>
              </Box>
              <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography sx={{ fontSize: 24, fontWeight: 500, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
                  {added}
                </Typography>
                <Box>
                  <Typography sx={{ fontSize: 13, color: 'var(--ink)' }}>
                    {added === 1 ? 'product' : 'products'} added this period
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mt: 0.25 }}>
                    Verify SKU, cost, and bin location before selling
                  </Typography>
                </Box>
              </Box>
            </Box>
          )}

        </Box>{/* end RIGHT */}
      </Box>{/* end TWO COLUMN */}

    </Box>
  );
}