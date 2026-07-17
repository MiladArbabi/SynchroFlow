/* eslint-disable @typescript-eslint/no-unused-vars */
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
import { FT2PresetSelector, type FT2DateRange } from '@lasyncro/ui-ft2';
import { Box, Typography, Divider, useTheme } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useProductsCatalog } from '../products/useProductsCatalog';
import type { CatalogVariant } from '../products/useProductsCatalog';

interface Props {
  range: FT2DateRange;
  onChange: (range: FT2DateRange) => void;
}

function PulseRow({ label, value, valueColor, sub }: { label: string; value: string; valueColor?: string; sub?: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', py: 1, borderBottom: '1px solid var(--rule)' }}>
      <Box>
        <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>{label}</Typography>
        {sub && <Typography sx={{ fontSize: 10, fontWeight: 300, color: 'var(--ink-4)', mt: 0.125 }}>{sub}</Typography>}
      </Box>
      <Typography sx={{ fontSize: 13, fontWeight: 600, color: valueColor ?? 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
    </Box>
  );
}

export default function ProductsCatalogPage({ range, onChange }: Props) {
  const theme = useTheme();
  const navigate = useNavigate();
  const operatorQuery = useProductsOperatorSummary(range);
  const catalogQuery = useProductsCatalog();

  // ── Pagination + sort state ───────────────────────────────
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  type SortField = 'title' | 'variants' | 'onhand' | 'available' | 'status';
  type SortDir = 'asc' | 'desc';
  const [sortField, setSortField] = useState<SortField>('title');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [noSkuPage, setNoSkuPage] = useState(1);
  const [noInventoryPage, setNoInventoryPage] = useState(1);

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

  const { noSkuProducts, noInventoryProducts, sellability, drift } = operatorQuery.data;
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
  const onHandOf = (p: typeof productGroups[string]) => p.variants.reduce((s, v) => s + v.on_hand_quantity, 0);
  const availOf = (p: typeof productGroups[string]) => p.variants.reduce((s, v) => s + v.available_quantity, 0);
  const statusRankOf = (p: typeof productGroups[string]) => {
    const oh = onHandOf(p);
    if (p.variants.some(v => !v.has_inventory_record)) return 4; // not received — highest severity, no warehouse data at all
    if (oh < 0) return 3;                              // phantom
    if (p.variants.some(v => !v.sku)) return 1;        // no SKU
    if (oh === 0) return 2;                            // zero stock
    return 0;                                          // sellable
  };
  const allProducts = Object.values(productGroups).sort((a, b) => {
    const mul = sortDir === 'asc' ? 1 : -1;
    if (sortField === 'title') return mul * a.title.localeCompare(b.title);
    if (sortField === 'variants') return mul * (a.variants.length - b.variants.length);
    if (sortField === 'onhand') return mul * (onHandOf(a) - onHandOf(b));
    if (sortField === 'available') return mul * (availOf(a) - availOf(b));
    if (sortField === 'status') return mul * (statusRankOf(a) - statusRankOf(b));
    return 0;
  });

  const totalPages = Math.ceil(allProducts.length / perPage);
  const products = allProducts.slice((page - 1) * perPage, page * perPage);

  // Image lookup: product title → image_url from catalog variants
  const titleToImage = Object.values(productGroups).reduce<Record<string, string | null>>(
    (acc, p) => { acc[p.title] = p.image_url; return acc; }, {}
  );

  // No-SKU pagination
  const noSkuTotalPages = Math.ceil(noSkuProducts.length / perPage);
  const pagedNoSkuProducts = noSkuProducts.slice((noSkuPage - 1) * perPage,noSkuPage * perPage);

  // No-inventory pagination
  const noInventoryTotalPages = Math.ceil(noInventoryProducts.length / perPage);
  const pagedNoInventoryProducts = noInventoryProducts.slice((noInventoryPage - 1) * perPage, noInventoryPage * perPage);

  const totalProducts = (sellability.sellable ?? 0) + (sellability.blocked ?? 0);
  const added = drift.addedThisPeriod ?? 0;

  const cardSx = {
    bgcolor: 'var(--surface)',
    border: '0.5px solid var(--rule)',
    borderRadius: '10px',
    overflow: 'hidden',
  };
  // Full-width catalog grid: Product | Variants | On-hand | Available | Status | Action
  const CATALOG_GRID = 'minmax(0,1fr) 90px 100px 100px 120px 120px';

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
          {allProducts.length} products · {variants.length} variants
          {(sellability.blockedReasons.noSku ?? 0) > 0 && ` · ${sellability.blockedReasons.noSku} missing SKU`}
        </Typography>
      </Box>

      {/* ── TRIAGE + PULSE (canonical FT2 layout — see modules-ux-playbook) ── */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2.25, alignItems: 'stretch', mb: 3 }}>
        {/* Decision card */}
        <Box sx={{ flex: '1 0 300px', minWidth: 0, bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', overflow: 'hidden' }}>
          <Box sx={{ px: 2.5, pt: 2.25, pb: 1.5 }}>
            <Typography sx={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>Needs attention</Typography>
            <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)', mt: 0.25 }}>
              Fix what's blocking stock from being sellable
            </Typography>
          </Box>
          {(() => {
            const phantom = sellability.blockedReasons.phantom ?? 0;
            const zeroStock = sellability.blockedReasons.zeroStock ?? 0;
            const noSku = sellability.blockedReasons.noSku ?? 0;
            const noInventory = sellability.blockedReasons.noInventory ?? 0;
            const rows: { label: string; sub: string; accent: string; cta: string; onClick: () => void }[] = [];
            if (phantom > 0) rows.push({ label: `${phantom} phantom`, sub: 'Sold without recorded receiving', accent: '#E5484D', cta: 'Check receiving →', onClick: () => navigate('/wms') });
            if (noSku > 0) rows.push({ label: `${noSku} missing SKU`, sub: 'Add a unique SKU in Shopify, then re-sync', accent: '#E5484D', cta: 'Fix below →', onClick: () => { document.getElementById('no-sku-section')?.scrollIntoView({ behavior: 'smooth' }); } });
            if (noInventory > 0) rows.push({ label: `${noInventory} not yet received`, sub: 'Has a SKU but no warehouse inventory record', accent: '#E5484D', cta: 'See below →', onClick: () => { document.getElementById('no-inventory-section')?.scrollIntoView({ behavior: 'smooth' }); } });
            if (zeroStock > 0) rows.push({ label: `${zeroStock} zero stock`, sub: 'Genuinely empty — reorder to sell again', accent: '#D9A23B', cta: 'See demand →', onClick: () => navigate('/demand') });
            if (rows.length === 0) {
              return (
                <Box sx={{ px: 2.5, py: 4, textAlign: 'center', borderTop: '1px solid var(--rule)' }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-4)' }}>All stock sellable — nothing blocked.</Typography>
                </Box>
              );
            }
            return rows.map((r, i) => (
              <Box key={i} sx={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', alignItems: 'center', gap: 2, px: 2.5, py: 1.75, borderTop: '1px solid var(--rule)', '&:hover': { bgcolor: 'var(--bg-2)' } }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 500, color: r.accent }}>{r.label}</Typography>
                  <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)', mt: 0.125 }}>{r.sub}</Typography>
                </Box>
                <Box onClick={r.onClick} sx={{ display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap', '&:hover': { opacity: 0.75 } }}>{r.cta}</Box>
              </Box>
            ));
          })()}
        </Box>

        {/* Pulse card */}
        <Box sx={{ flex: { xs: '1 0 300px', lg: '0 0 300px' }, minWidth: 0, bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', p: '18px 20px' }}>
          <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>
            Catalog health
          </Typography>
          <PulseRow label="Sellable" value={String(sellability.sellable ?? 0)} valueColor={(sellability.sellable ?? 0) > 0 ? '#4CAF7A' : undefined} />
          <PulseRow label="Blocked" value={String(sellability.blocked ?? 0)} valueColor={(sellability.blocked ?? 0) > 0 ? '#E5484D' : undefined} />
          <PulseRow label="Phantom" value={String(sellability.blockedReasons.phantom ?? 0)} valueColor={(sellability.blockedReasons.phantom ?? 0) > 0 ? '#E5484D' : undefined} sub="sold without recorded receiving" />
          <PulseRow label="Zero stock" value={String(sellability.blockedReasons.zeroStock ?? 0)} valueColor={(sellability.blockedReasons.zeroStock ?? 0) > 0 ? '#D9A23B' : undefined} />
          <PulseRow label="Missing SKU" value={String(sellability.blockedReasons.noSku ?? 0)} valueColor={(sellability.blockedReasons.noSku ?? 0) > 0 ?'#E5484D' : undefined} />
          <PulseRow label="Not received" value={String(sellability.blockedReasons.noInventory ?? 0)} valueColor={(sellability.blockedReasons.noInventory ?? 0) > 0 ? '#E5484D' : undefined} sub="has SKU, no warehouse record" />
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pt: 1 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>Variants</Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{variants.length}</Typography>
          </Box>
        </Box>
      </Box>

      {/* Catalog drift — always visible; date range scoped to this card only */}
      <Box sx={{ ...cardSx, mb: 2 }}>
        <Box sx={headerSx}>
          <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
            Catalog drift
          </Typography>
          <FT2PresetSelector
            preset={range.preset === 'custom' ? 'past_30_days' : range.preset}
            onSelect={(preset) => onChange({ preset, from: null, to: null })}
          />
        </Box>
        <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography sx={{ fontSize: 24, fontWeight: 500, color: added > 0 ? 'var(--accent)' : 'var(--ink-4)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
            {added}
          </Typography>
          <Box>
            <Typography sx={{ fontSize: 13, color: 'var(--ink)' }}>
              {added === 0 ? 'No products added this period' : `${added === 1 ? 'product' : 'products'} added this period`}
            </Typography>
            {added > 0 && (
              <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mt: 0.25 }}>
                Verify SKU, cost, and bin location before selling
              </Typography>
            )}
          </Box>
        </Box>
      </Box>

      {/* ── STACKED BODY — full-width list, no-SKU panel below ── */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

        {/* Product list — full width */}
        <Box sx={{ width: '100%' }}>
          {products.length > 0 && (
            <Box sx={cardSx}>
              {/* ── Column headers ── */}
              <Box sx={{ display: 'grid', gridTemplateColumns: CATALOG_GRID, gap: 2, alignItems: 'center', px: 2, py: 1.25, bgcolor: 'var(--bg)', borderBottom: '0.5px solid var(--rule)' }}>
                {([
                  { f: 'title', label: 'Product', align: 'left' },
                  { f: 'variants', label: 'Variants', align: 'right' },
                  { f: 'onhand', label: 'On-hand', align: 'right' },
                  { f: 'available', label: 'Available', align: 'right' },
                  { f: 'status', label: 'Status', align: 'right' },
                  { f: null, label: 'Action', align: 'right' },
                ] as const).map(({ f, label, align }) => (
                  <Box
                    key={label}
                    onClick={() => f && handleSort(f)}
                    sx={{ display: 'flex', alignItems: 'center', gap: 0.5, justifyContent: align === 'right' ? 'flex-end' : 'flex-start', cursor: f ? 'pointer' : 'default' }}
                  >
                    <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: f && sortField === f ? 'var(--accent)' : 'var(--ink-4)', '&:hover': { color: f ? 'var(--accent)' : undefined } }}>
                      {label}
                    </Typography>
                    {f && sortField === f && (
                      <Typography sx={{ fontSize: 9, color: 'var(--accent)' }}>{sortDir === 'asc' ? '↑' : '↓'}</Typography>
                    )}
                  </Box>
                ))}
              </Box>

              {/* ── Product rows ── */}
              {products.map((product, idx) => {
                const totalStock = product.variants.reduce((s, v) => s + v.on_hand_quantity, 0);
                const totalAvailable = product.variants.reduce((s, v) => s + v.available_quantity, 0);
                const hasNoSku = product.variants.some(v => !v.sku);
                const notReceived = product.variants.some(v => !v.has_inventory_record);
                const isZeroStock = totalStock === 0 && !notReceived;
                return (
                  <Box key={product.title}>
                    {idx > 0 && <Divider sx={{ borderColor: 'var(--rule)' }} />}
                    <Box sx={{ display: 'grid', gridTemplateColumns: CATALOG_GRID, gap: 2, alignItems: 'center', px: 2, py: 1.25, '&:hover': { bgcolor: 'action.hover' }, cursor: 'pointer' }}>
                      {/* Product */}
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                        <Box sx={{ width: 36, height: 36, borderRadius: '6px', flexShrink: 0, bgcolor: 'var(--bg)', border: '0.5px solid var(--rule)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {product.image_url
                            ? <img src={product.image_url} alt={product.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'var(--ink-4)' }}>{product.title.charAt(0).toUpperCase()}</Typography>
                          }
                        </Box>
                        <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {product.title}
                        </Typography>
                      </Box>
                      {/* Variants */}
                      <Typography sx={{ fontSize: 12, color: 'var(--ink-4)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {product.variants.length}
                      </Typography>
                      {/* On-hand */}
                      <Typography sx={{ fontSize: 13, fontWeight: 500, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: totalStock < 0 ? theme.palette.error.main : totalStock === 0 ? theme.palette.warning.main : 'var(--ink)' }}>
                        {totalStock}
                      </Typography>
                      {/* Available */}
                      <Typography sx={{ fontSize: 13, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--ink-4)' }}>
                        {totalAvailable}
                      </Typography>
                      {/* Status */}
                      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                        {(() => {
                          const s = notReceived
                            ? { label: 'Not received', color: '#E5484D' }
                            : totalStock < 0
                            ? { label: 'Phantom', color: '#E5484D' }
                            : hasNoSku
                            ? { label: 'No SKU', color: '#E5484D' }
                            : isZeroStock
                            ? { label: 'Zero stock', color: '#D9A23B' }
                            : { label: 'Sellable', color: '#4CAF7A' };
                          return (
                            <Typography sx={{ fontSize: 11, fontWeight: 500, color: s.color, px: 1, py: 0.25, borderRadius: '6px', border: `0.5px solid ${s.color}`, bgcolor: `${s.color}1A` }}>
                              {s.label}
                            </Typography>
                          );
                        })()}
                      </Box>
                      {/* Action */}
                      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                        {notReceived ? (
                          <Box onClick={(e) => { e.stopPropagation(); document.getElementById('no-inventory-section')?.scrollIntoView({ behavior: 'smooth' }); }} sx={{ display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap', '&:hover': { opacity: 0.75 } }}>See below →</Box>
                        ) : totalStock < 0 ? (
                          <Box onClick={(e) => { e.stopPropagation(); navigate('/wms'); }} sx={{ display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, color: 'var(--accent)',border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap', '&:hover': { opacity: 0.75 } }}>Check →</Box>
                        ) : hasNoSku ? (
                          <Box onClick={(e) => { e.stopPropagation(); document.getElementById('no-sku-section')?.scrollIntoView({ behavior: 'smooth' }); }} sx={{ display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap', '&:hover': { opacity: 0.75 } }}>Fix →</Box>
                        ) : isZeroStock ? (
                          <Box onClick={(e) => { e.stopPropagation(); navigate('/suppliers'); }} sx={{ display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 600, bgcolor: 'var(--accent)', color: theme.palette.common.white, borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap', '&:hover': { opacity: 0.88 } }}>Reorder →</Box>
                        ) : null}
                      </Box>
                    </Box>
                  </Box>
                );
              })}

              {/* ── Pagination footer ── */}
              {allProducts.length > 0 && (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1, bgcolor: 'var(--bg)', borderTop: '0.5px solid var(--rule)' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
                      {((page - 1) * perPage) + 1}–{Math.min(page * perPage, allProducts.length)} of {allProducts.length} products
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      {[10, 25, 50, 100].map(n => (
                        <Box key={n} onClick={() => { setPerPage(n); setPage(1); setNoSkuPage(1); }}
                          sx={{ px: 1, py: 0.25, fontSize: 10, border: '0.5px solid', borderColor: n === perPage ? 'var(--accent)' : 'var(--rule)', borderRadius: '4px', bgcolor: n === perPage ? 'var(--accent-ghost)' : 'var(--surface)', color: n === perPage ? 'var(--accent)' : 'var(--ink-4)', cursor: 'pointer', fontWeight: n === perPage ? 600 : 400 }}>
                          {n}
                        </Box>
                      ))}
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {totalPages > 1 && <Box onClick={() => page > 1 && setPage(p => p - 1)} sx={{ px: 1.5, py: 0.5, borderRadius: '6px', cursor: page > 1 ? 'pointer' : 'not-allowed', border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)', fontSize: 12, color: page > 1 ? 'var(--ink-3)' : 'var(--ink-4)', opacity: page > 1 ? 1 : 0.4 }}>← Prev</Box>}
                    {totalPages > 1 && Array.from({ length: totalPages }, (_, i) => (
                      <Box key={i} onClick={() => setPage(i + 1)}
                        sx={{ px: 1.5, py: 0.5, fontSize: 11, border: '0.5px solid', borderColor: i + 1 === page ? 'var(--accent)' : 'var(--rule)', borderRadius: '6px', bgcolor: i + 1 === page ? 'var(--accent)' : 'var(--surface)', color: i + 1 === page ? '#fff' : 'var(--ink-3)', cursor: 'pointer', fontWeight: i + 1 === page ? 600 : 400 }}>
                        {i + 1}
                      </Box>
                    ))}
                    {totalPages > 1 && <Box onClick={() => page < totalPages && setPage(p => p + 1)} sx={{ px: 1.5, py: 0.5, borderRadius: '6px', cursor: page < totalPages ? 'pointer' : 'not-allowed', border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)', fontSize: 12, color: page < totalPages ? 'var(--ink-3)' : 'var(--ink-4)', opacity: page < totalPages ? 1 : 0.4 }}>Next →</Box>}
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </Box>

        {/* No-SKU section + Not-received section — full width, below list */}
        <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {noSkuProducts.length > 0 && (
            <Box id="no-sku-section" sx={cardSx}>
              {/* Header */}
              <Box sx={{ ...headerSx, bgcolor: 'var(--bg)' }}>
                <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                  {sellability.blockedReasons.noSku} variants · {noSkuProducts.length} products missing SKU
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
              {noSkuProducts.length > 0 && (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1, bgcolor: 'var(--bg)', borderTop: '0.5px solid var(--rule)' }}>
                  <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
                    {((noSkuPage - 1) * perPage) + 1}–{Math.min(noSkuPage * perPage, noSkuProducts.length)} of {noSkuProducts.length}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {noSkuTotalPages > 1 && <Box onClick={() => noSkuPage > 1 && setNoSkuPage(p => p - 1)} sx={{ px: 1.5, py: 0.5, borderRadius: '6px', cursor: noSkuPage > 1 ? 'pointer' : 'not-allowed', border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)', fontSize: 12, color: noSkuPage > 1 ? 'var(--ink-3)' : 'var(--ink-4)', opacity: noSkuPage > 1 ? 1 : 0.4 }}>← Prev</Box>}
                    {noSkuTotalPages > 1 && Array.from({ length: noSkuTotalPages }, (_, i) => (
                      <Box key={i} onClick={() => setNoSkuPage(i + 1)}
                        sx={{ px: 1.5, py: 0.5, fontSize: 11, border: '0.5px solid', borderColor: i + 1 === noSkuPage ? 'var(--accent)' : 'var(--rule)', borderRadius: '6px', bgcolor: i + 1 === noSkuPage ? 'var(--accent)' : 'var(--surface)', color: i + 1 === noSkuPage ? '#fff' : 'var(--ink-3)', cursor: 'pointer', fontWeight: i + 1 === noSkuPage ? 600 : 400 }}>
                        {i + 1}
                      </Box>
                    ))}
                    {noSkuTotalPages > 1 && <Box onClick={() => noSkuPage < noSkuTotalPages && setNoSkuPage(p => p + 1)} sx={{ px: 1.5, py: 0.5, borderRadius: '6px', cursor: noSkuPage < noSkuTotalPages ? 'pointer' : 'not-allowed', border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)', fontSize: 12, color: noSkuPage < noSkuTotalPages ? 'var(--ink-3)' : 'var(--ink-4)', opacity: noSkuPage < noSkuTotalPages ? 1 : 0.4 }}>Next →</Box>}
                  </Box>
                </Box>
              )}
            </Box>
          )}
          {noInventoryProducts.length > 0 && (
            <Box id="no-inventory-section" sx={cardSx}>
              {/* Header */}
              <Box sx={{ ...headerSx, bgcolor: 'var(--bg)' }}>
                <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                  {sellability.blockedReasons.noInventory} variants · {noInventoryProducts.length} products not received
                </Typography>
                <Typography sx={{ fontSize: 11, fontWeight: 500, color: theme.palette.error.main }}>
                  No warehouse record
                </Typography>
              </Box>
              <Box sx={{ px: 2, py: 1, borderBottom: '0.5px solid var(--rule)' }}>
                <Typography sx={{ fontSize: 12, color: 'var(--ink-4)' }}>
                  Has a SKU, but never received into the warehouse — receive stock to make it sellable.
                </Typography>
              </Box>
              {/* Rows with images */}
              {pagedNoInventoryProducts.map((p, idx) => {
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
              {noInventoryProducts.length > 0 && (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1, bgcolor: 'var(--bg)', borderTop: '0.5px solid var(--rule)' }}>
                  <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
                    {((noInventoryPage - 1) * perPage) + 1}–{Math.min(noInventoryPage * perPage, noInventoryProducts.length)} of {noInventoryProducts.length}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {noInventoryTotalPages > 1 && <Box onClick={() => noInventoryPage > 1 && setNoInventoryPage(p => p - 1)} sx={{ px: 1.5, py: 0.5, borderRadius: '6px', cursor: noInventoryPage > 1 ? 'pointer' : 'not-allowed', border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)', fontSize: 12, color: noInventoryPage > 1 ? 'var(--ink-3)' : 'var(--ink-4)', opacity: noInventoryPage > 1 ? 1 : 0.4 }}>← Prev</Box>}
                    {noInventoryTotalPages > 1 && Array.from({ length: noInventoryTotalPages }, (_, i) => (
                      <Box key={i} onClick={() => setNoInventoryPage(i + 1)}
                        sx={{ px: 1.5, py: 0.5, fontSize: 11, border: '0.5px solid', borderColor: i + 1 === noInventoryPage ? 'var(--accent)' : 'var(--rule)', borderRadius: '6px', bgcolor: i + 1 === noInventoryPage ? 'var(--accent)' : 'var(--surface)', color: i + 1 === noInventoryPage ? '#fff' : 'var(--ink-3)', cursor: 'pointer', fontWeight: i + 1 === noInventoryPage ? 600 : 400 }}>
                        {i + 1}
                      </Box>
                    ))}
                    {noInventoryTotalPages > 1 && <Box onClick={() => noInventoryPage < noInventoryTotalPages && setNoInventoryPage(p => p + 1)} sx={{ px: 1.5, py: 0.5, borderRadius: '6px', cursor: noInventoryPage < noInventoryTotalPages ? 'pointer' : 'not-allowed', border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)', fontSize: 12, color: noInventoryPage < noInventoryTotalPages ? 'var(--ink-3)' : 'var(--ink-4)', opacity: noInventoryPage < noInventoryTotalPages ? 1 : 0.4 }}>Next →</Box>}
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </Box>{/* end RIGHT */}
      </Box>{/* end TWO COLUMN */}

    </Box>
  );
}