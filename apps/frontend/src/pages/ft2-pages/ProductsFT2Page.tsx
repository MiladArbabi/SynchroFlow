// apps/frontend/src/pages/ft2-pages/ProductsFT2Page.tsx
//
// ProductsFT2Page
// ---------------
// Gate + tab router for the Products module.
// Mirrors OrdersFT2Page pattern — ModuleTabBar owns navigation,
// child pages own their own data fetching.
//
// Tabs:
//   /products           → Intelligence (priority signals, ranked by $ impact)
//   /products/catalog   → Catalog (full SKU list, no-SKU products)
//   /products/costs     → Costs (cost entry + bulk CSV upload)
//   /products/wms-readiness → WMS Readiness (pickability, variance, shrinkage)

import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { CommercialGate } from '../../components/CommercialGate';
import { INVENTORY_MODULE_TABS } from './inventoryModuleTabs';
import type { FT2DateRange } from '@lasyncro/ui-ft2';
import { useProductsFt2Snapshot } from '../products/useProductsFt2Snapshot';
import { mapProductsFt2Props } from '../products/useProductsFt2Adapter';
import { useProductsOperatorSummary } from '../products/useProductsOperatorSummary';
import type { ProductsOperatorSummary } from '../products/useProductsOperatorSummary';
import { useEntitlements } from 'contexts/EntitlementsContext';
import { useExchangeRates } from 'hooks/useExchangeRates';
import { ProductsModuleFT2 } from '@lasyncro/products';
import { ExportDrawer } from 'components/ExportDrawer';
import ProductsCatalogPage from './ProductsCatalogPage';
import ProductsCostsPage from './ProductsCostsPage';
import ProductsWmsReadinessPage from './ProductsWmsReadinessPage';
import { IsometricCanvas } from '@lasyncro/shared/ui';
import type { WarehouseZone } from '@lasyncro/shared/ui';
import type { CurrencyContext } from '@lasyncro/shared/ui-contracts';
import { LiveMapTeaser } from 'components/LiveMapTeaser';
import { useCommercialAccess } from '../../runtime/commercialContext';
import { useFloorPlanning } from '../floor-planning/useFloorPlanning';
import { useWarehouseGridOccupancy } from '../floor-planning/useWarehouseGrid';

const __DEV__ = import.meta.env.DEV;

/**
 * INVENTORY INTELLIGENCE — app-side commercial + data boundary (INV-UX-01 2B)
 * ---------------------------------------------------------------------------
 * Deliberately a separate component mounted ONLY by <Route path="/">.
 *
 * ProductsFT2Page hosts every /inventory child, so placing these hooks at its
 * top level would make Catalog, Costs and Data Quality acquire floor geometry
 * and occupancy they never render. Scoping them here keeps map data acquisition
 * tied to the one surface that shows a map.
 *
 * The canonical inventory.live_map AccessDecision is the only authority for map
 * eligibility. Never reconstruct it from a raw tier compare.
 */
function InventoryIntelligenceView({
  snapshotQuery,
  operatorQuery,
  currency,
  onExport,
}: {
  snapshotQuery: ReturnType<typeof useProductsFt2Snapshot>;
  operatorQuery: ReturnType<typeof useProductsOperatorSummary>;
  currency: CurrencyContext;
  onExport: () => void | Promise<void>;
}) {
  const navigate = useNavigate();

  // isResolved is the canonical commercial-resolution signal — map access stays
  // false until the entitlement snapshot lands, so a Growth tenant never sees a
  // teaser flash before resolution.
  const { decide, isResolved } = useCommercialAccess();
  const liveMapDecision = decide('inventory.live_map');
  const hasMapAccess = isResolved && liveMapDecision.allowed;

  // A denied tenant must not ACQUIRE floor geometry either — the same decision
  // that hides the map stops the layout fetch.
  const floorPlanning = useFloorPlanning(hasMapAccess);
  const zones: WarehouseZone[] = floorPlanning.data?.zones ?? [];

  // Matches Overview semantics exactly (OverviewFT2Page hasPlacedFloor): a floor
  // exists only when a zone carries geometry. Every shop is bootstrapped with a
  // WH-{shopId}-ROOT row whose position_x/position_y are null, so a row count
  // would report a floor that IsometricCanvas would then paint empty.
  const hasPlacedFloor = zones.some(
    (z: WarehouseZone) => z.position_x != null && z.position_y != null
  );

  const occupancyQuery = useWarehouseGridOccupancy(hasMapAccess && hasPlacedFloor);

  let mapContent: ReactNode;

  if (!hasMapAccess) {
    // Core (or any canonical denial): full-size teaser in the map slot. The
    // right rail keeps showing real Inventory Pulse and decisions.
    mapContent = (
      <LiveMapTeaser
        requiredTier={liveMapDecision.requiredTier ?? null}
        onUpgrade={() => navigate('/settings/billing')}
      />
    );
  } else if (hasPlacedFloor) {
    mapContent = (
      <Box sx={{
        minHeight: 520, height: '100%', display: 'flex', flexDirection: 'column',
        borderRadius: '14px', overflow: 'hidden', border: '0.5px solid var(--rule)',
      }}>
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <IsometricCanvas
            zones={zones}
            occupancy={occupancyQuery.data?.occupancy}
            overlay="occupancy"
            showLegend={false}
            showControls={false}
            enableHoverFocus
            disablePan
            autoFit
            fitPhysicalFloorFirst
            fitPadding={0.88}
          />
        </Box>
      </Box>
    );
  } else {
    // Allowed, but no floor has been mapped yet. Never fall back to the old
    // dashboard — the map slot explains what is missing and how to fix it.
    mapContent = (
      <Box sx={{
        minHeight: 520, height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', textAlign: 'center',
        gap: 1, p: 3,
        borderRadius: '14px', border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)',
      }}>
        <Typography sx={{ fontSize: 16, fontWeight: 500, color: 'var(--ink)' }}>
          Map your warehouse floor first
        </Typography>
        <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)', maxWidth: 360, mb: 1.5 }}>
          Place your zones and bins once, and this becomes a live view of where
          every unit actually sits.
        </Typography>
        <Box
          component="button"
          type="button"
          onClick={() => navigate('/floor-planning?tab=setup&view=canvas')}
          sx={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            px: '14px', py: '7px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
            color: 'var(--accent-ink)', bgcolor: 'var(--accent)',
            border: 'none', borderRadius: '6px', cursor: 'pointer',
            '&:hover': { opacity: 0.88 },
          }}
        >
          Map the floor
        </Box>
      </Box>
    );
  }

  if (!snapshotQuery.isSuccess) {
    if (__DEV__) console.debug('[ProductsFT2Page] awaiting FT2 snapshot');
    return <div>Loading product insights…</div>;
  }

  const props = mapProductsFt2Props(snapshotQuery.data);
  const operatorSummary: ProductsOperatorSummary | null =
    operatorQuery.isSuccess ? operatorQuery.data : null;

  if (__DEV__) console.debug('[ProductsFT2Page] rendering intelligence tab', { props, operatorSummary });

  return (
    <ProductsModuleFT2
      {...props}
      operatorSummary={operatorSummary}
      currency={currency}
      mapContent={mapContent}
      onExport={onExport}
    />
  );
}

export default function ProductsFT2Page() {
  const [range, setRange] = useState<FT2DateRange>({
    preset: 'past_30_days',
    from: null,
    to: null,
  });

  const snapshotQuery = useProductsFt2Snapshot(range);
  const operatorQuery = useProductsOperatorSummary(range);
  const [exportDrawerOpen, setExportDrawerOpen] = useState(false);
  const { displayCurrency, locale, tier } = useEntitlements();
  const { rates } = useExchangeRates();

  // P0-A3-4: the Inventory management subtree is owned by `inventory.core`.
  // LifecycleRouteHost mounts this component at `/inventory/*`, so ONE gate here
  // covers /inventory, /inventory/catalog, /inventory/costs and
  // /inventory/data-quality — a direct URL resolves the same AccessDecision as a
  // nav/tab click. Nav presentation is not a security boundary.
  //
  // Demand is unaffected: it is not routed through this subtree and keeps its own
  // demand.forecasting decision.
  return (
    <CommercialGate capabilityId="inventory.core" featureName="Inventory">
      <ModuleTabBar tabs={INVENTORY_MODULE_TABS} />

      <Routes>
        <Route path="/" element={
          <InventoryIntelligenceView
            snapshotQuery={snapshotQuery}
            operatorQuery={operatorQuery}
            currency={{ displayCurrency, locale, rates }}
            onExport={async () => setExportDrawerOpen(true)}
          />
        } />

        <Route path="/catalog"        element={<ProductsCatalogPage range={range} onChange={setRange} />} />
        <Route path="/costs"          element={<ProductsCostsPage />} />
        <Route path="/data-quality"   element={<ProductsWmsReadinessPage />} />
        <Route path="*"               element={<Navigate to="/inventory" replace />} />
      </Routes>
      {/* EXP-CTA-INVENTORY-99 — pre-filtered to this view per
          export_system_playbook §7. */}
      <ExportDrawer
        open={exportDrawerOpen}
        onClose={() => setExportDrawerOpen(false)}
        reportIds={['products']}
      />
    </CommercialGate>
  );
}