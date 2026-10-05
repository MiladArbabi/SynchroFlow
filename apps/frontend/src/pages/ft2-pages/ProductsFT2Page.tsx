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

import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { CommercialGate } from '../../components/CommercialGate';
import { INVENTORY_MODULE_TABS } from './inventoryModuleTabs';
import type { FT2DateRange } from '@lasyncro/ui-ft2';
import { useProductsFt2Snapshot } from '../products/useProductsFt2Snapshot';
import { mapProductsFt2Props } from '../products/useProductsFt2Adapter';
import type { ProductsFt2Snapshot } from '../products/useProductsFt2Adapter';
import { useProductsOperatorSummary } from '../products/useProductsOperatorSummary';
import type { ProductsOperatorSummary } from '../products/useProductsOperatorSummary';
import { useEntitlements } from 'contexts/EntitlementsContext';
import { useExchangeRates } from 'hooks/useExchangeRates';
import { ProductsModuleFT2 } from '@lasyncro/products';
import type { InventoryStateFacts, InventoryStateStatus } from '@lasyncro/products';
import { ExportDrawer } from 'components/ExportDrawer';
import ProductsCatalogPage from './ProductsCatalogPage';
import { IsometricCanvas } from '@lasyncro/shared/ui';
import type { WarehouseZone, LocationPulse, LocationStockDetail, LocationStockVariant } from '@lasyncro/shared/ui';
import type { CurrencyContext } from '@lasyncro/shared/ui-contracts';
import { LiveMapTeaser } from 'components/LiveMapTeaser';
import { LiveMapFooter, EDIT_FLOOR_MAP_ROUTE } from 'components/LiveMapFooter';
import { useCommercialAccess } from '../../runtime/commercialContext';
import { useFloorPlanning } from '../floor-planning/useFloorPlanning';
import { hasOperationalFloor } from '../floor-planning/operationalFloor';
import { useWarehouseGridOccupancy } from '../floor-planning/useWarehouseGrid';
import useConfig from 'hooks/useConfig';

const __DEV__ = import.meta.env.DEV;

// The adapter maps every absent snapshot field to its own null/empty default,
// so an unavailable snapshot degrades snapshot-derived context without
// fabricating values or blocking the independent Inventory surfaces.
const EMPTY_PRODUCTS_FT2_SNAPSHOT = {} as ProductsFt2Snapshot;

// Scoped map-slot states (floor geometry) — never the no-floor setup state.
const MAP_SLOT_SX = {
  minHeight: 520, height: '100%', display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center', textAlign: 'center',
  gap: 1, p: 3,
  borderRadius: '14px', border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)',
} as const;

const RETRY_BUTTON_SX = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  px: '12px', py: '5px', fontSize: 12, fontWeight: 500, fontFamily: 'inherit',
  color: 'var(--accent)', bgcolor: 'transparent',
  border: '0.5px solid var(--accent-border)', borderRadius: '6px', cursor: 'pointer',
  '&:hover': { opacity: 0.75 },
} as const;

// ─── Spatial inspection (Inventory-owned; the canvas only paints plates) ──────

type LocationTruthQuality = 'Phantom' | 'Physically empty' | 'Fully reserved' | 'Confirmed';

const TRUTH_QUALITY_TONE: Record<LocationTruthQuality, LocationPulse['rows'][number]['tone']> = {
  Phantom: 'critical',
  'Physically empty': 'muted',
  'Fully reserved': 'warning',
  Confirmed: 'default',
};

/**
 * Location truth quality, first match wins:
 *   Phantom          — any row with signed on_hand < 0
 *   Physically empty — truth rows exist, aggregate on_hand 0, no negative row
 *   Fully reserved   — on_hand > 0, available 0, reserved > 0
 *   Confirmed        — otherwise
 * Not received / No valid pick location are variant/shop states (rail
 * context) and never belong to a location.
 */
function locationTruthQuality(detail: LocationStockDetail): LocationTruthQuality {
  if (detail.variants.some((v) => v.on_hand_quantity < 0)) return 'Phantom';
  if (detail.on_hand_quantity === 0) return 'Physically empty';
  if (detail.on_hand_quantity > 0 && detail.available_quantity === 0 && detail.reserved_quantity > 0) {
    return 'Fully reserved';
  }
  return 'Confirmed';
}

/** Only positioned, non-frame bins are Inventory inspection targets (never ROOT). */
function isInspectableInventoryLocation(zone: WarehouseZone): boolean {
  return zone.type === 'bin' && zone.position_x != null && zone.position_y != null;
}

const fmtUnits = (n: number): string => Math.round(n).toLocaleString();

function locationIdentity(zone: WarehouseZone): string {
  const kind = zone.zone_type
    ? `${zone.zone_type.charAt(0).toUpperCase()}${zone.zone_type.slice(1)} ${zone.type}`
    : `${zone.type.charAt(0).toUpperCase()}${zone.type.slice(1)}`;
  return zone.active ? kind : `${kind} · inactive`;
}

/** SKU when present; otherwise the variant/product title. Never an invented SKU. */
function variantIdentity(variant: LocationStockVariant): string {
  return variant.sku ?? variant.variant_title ?? variant.product_title ?? 'Unidentified variant';
}

/** Hover plate: identity, On hand, Available, SKU count. No CTA. */
function compactLocationPulse(code: string, detail: LocationStockDetail): LocationPulse {
  return {
    title: code,
    rows: [
      { label: 'On hand', value: fmtUnits(detail.on_hand_quantity) },
      { label: 'Available', value: fmtUnits(detail.available_quantity) },
      { label: 'SKUs', value: String(detail.variants.length) },
    ],
  };
}

/** Pinned plate for the selected location — same channel, richer content. No CTA. */
function pinnedLocationPulse(code: string, zone: WarehouseZone, detail: LocationStockDetail): LocationPulse {
  const quality = locationTruthQuality(detail);
  return {
    title: code,
    subtitle: locationIdentity(zone),
    rows: [
      { label: 'On hand', value: fmtUnits(detail.on_hand_quantity) },
      { label: 'Available', value: fmtUnits(detail.available_quantity) },
      { label: 'Reserved', value: fmtUnits(detail.reserved_quantity) },
      ...(quality === 'Confirmed' ? [] : [{ label: 'Truth', value: quality, tone: TRUTH_QUALITY_TONE[quality] }]),
      { label: 'SKU', value: 'On hand · Available · Reserved', tone: 'muted' },
      ...detail.variants.map((variant) => ({
        label: variantIdentity(variant),
        value:
          `${fmtUnits(variant.on_hand_quantity)} · ` +
          `${fmtUnits(variant.available_quantity)} · ` +
          `${fmtUnits(variant.reserved_quantity)}`,
        tone: variant.on_hand_quantity < 0 ? ('critical' as const) : ('muted' as const),
      })),
    ],
  };
}

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

  // Page-owned spatial selection. The canvas keeps its own toggle grammar and
  // reports through onSelect / onPinnedClose.
  const [selectedLocationCode, setSelectedLocationCode] = useState<string | null>(null);

  // Shared Ops Console state (owned by the top-nav trigger). While the Console
  // is open it owns actionable attention, so the Inventory state rail
  // withdraws. This page owns no Console entry point of its own.
  const { state: { isOpsConsoleOpen } } = useConfig();

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
  // GH-1176: a positioned warehouse root alone is still not a floor.
  const hasPlacedFloor = hasOperationalFloor(zones);

  const occupancyQuery = useWarehouseGridOccupancy(hasMapAccess && hasPlacedFloor);

  // Canonical inspection truth → inspection targets, occupancy knowledge and
  // plates. A bin with no inspection record has no truth record: it is neither
  // inspectable nor painted as confirmed empty, and gets no plate.
  // Occupancy data is only a fact once it has loaded successfully. While it is
  // loading or failed, nothing is known, inspectable or plated — a failure is
  // never read as empty inventory.
  const occupancyStatus: 'loading' | 'error' | 'ready' =
    occupancyQuery.isError ? 'error'
    : occupancyQuery.isPending || occupancyQuery.isLoading ? 'loading'
    : 'ready';
  const occupancyData = occupancyStatus === 'ready' ? occupancyQuery.data : undefined;
  const inventoryInspection = occupancyData?.inventoryInspection;
  const zoneByCode = new Map(zones.map((zone) => [zone.location_code, zone]));
  const inspectionLocationCodes = new Set<string>();
  const locationPulseByCode: Record<string, LocationPulse> = {};
  for (const [code, detail] of Object.entries(inventoryInspection ?? {})) {
    const zone = zoneByCode.get(code);
    if (!zone || !isInspectableInventoryLocation(zone)) continue;
    inspectionLocationCodes.add(code);
    locationPulseByCode[code] = code === selectedLocationCode
      ? pinnedLocationPulse(code, zone, detail)
      : compactLocationPulse(code, detail);
  }

  let mapContent: ReactNode;

  if (!hasMapAccess) {
    // Core (or any canonical denial): full-size teaser in the map slot. The
    // Inventory state rail keeps showing real inventory facts.
    mapContent = (
      <LiveMapTeaser
        requiredTier={liveMapDecision.requiredTier ?? null}
        onUpgrade={() => navigate('/settings/billing')}
      />
    );
  } else if (floorPlanning.isLoading) {
    // Floor geometry still loading — never the no-floor setup state.
    mapContent = (
      <Box sx={MAP_SLOT_SX} aria-busy="true">
        <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }}>
          Checking your floor…
        </Typography>
      </Box>
    );
  } else if (floorPlanning.isError) {
    // Floor fetch failed (403 / 500 / timeout alike) — a recoverable map
    // failure, not a missing floor.
    mapContent = (
      <Box sx={MAP_SLOT_SX}>
        <Typography sx={{ fontSize: 16, fontWeight: 500, color: 'var(--ink)' }}>
          Warehouse map unavailable
        </Typography>
        <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)', maxWidth: 360, mb: 1.5 }}>
          The floor layout could not be loaded. Nothing in your warehouse has changed.
        </Typography>
        <Box component="button" type="button" onClick={() => { void floorPlanning.refetch(); }} sx={RETRY_BUTTON_SX}>
          Retry
        </Box>
      </Box>
    );
  } else if (hasPlacedFloor) {
    mapContent = (
      <Box sx={{
        position: 'relative',
        minHeight: 520, height: '100%', display: 'flex', flexDirection: 'column',
        borderRadius: '14px', overflow: 'hidden', border: '0.5px solid var(--rule)',
      }}>
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <IsometricCanvas
            zones={zones}
            occupancy={occupancyData?.occupancy}
            knownOccupancyLocationCodes={inspectionLocationCodes}
            inspectableLocationCodes={inspectionLocationCodes}
            locationPulseByCode={locationPulseByCode}
            selectedLocationCode={selectedLocationCode}
            onSelect={setSelectedLocationCode}
            onPinnedClose={() => setSelectedLocationCode(null)}
            pinnedAction={null}
            pinnedPulseWidth={288}
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
        {/* Navigation only — the map itself never mutates Inventory. */}
        <LiveMapFooter onEditFloorMap={() => navigate(EDIT_FLOOR_MAP_ROUTE)} />
        {occupancyStatus !== 'ready' && (
          // Scoped inventory-location status over the kept geometry. Anchored
          // top-right: the shared canvas owns the top-left corner (unplaced-
          // zones badge).
          <Box
            role="status"
            sx={{
              position: 'absolute', top: 12, right: 12,
              display: 'flex', alignItems: 'center', gap: 1.25,
              px: 1.5, py: 0.75, borderRadius: '8px',
              bgcolor: 'var(--surface)', border: '0.5px solid var(--rule)',
            }}
          >
            <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
              {occupancyStatus === 'loading' ? 'Loading inventory locations…' : 'Inventory locations unavailable'}
            </Typography>
            {occupancyStatus === 'error' && (
              <Box component="button" type="button" onClick={() => { void occupancyQuery.refetch(); }} sx={RETRY_BUTTON_SX}>
                Retry
              </Box>
            )}
          </Box>
        )}
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

  // The FT2 snapshot only feeds snapshot-derived context; it never gates the
  // Inventory state rail or the spatial workspace.
  const props = mapProductsFt2Props(snapshotQuery.data ?? EMPTY_PRODUCTS_FT2_SNAPSHOT);
  const operatorSummary: ProductsOperatorSummary | null =
    operatorQuery.isSuccess ? operatorQuery.data : null;

  // Inventory state data status. A successful response whose inventoryState
  // is null means the read model failed server-side — not ready data.
  const inventoryStateStatus: InventoryStateStatus =
    operatorQuery.isError ? 'error'
    : !operatorQuery.isSuccess ? 'loading'
    : operatorSummary?.inventoryState ? 'ready'
    : 'error';

  // Inventory state rail facts. Every fact comes from a canonical source whose
  // semantics match the rail label; a missing source stays null (unknown).
  // Never derive unit quantities from SKU-count metrics, and never turn a
  // missing fact into 0.
  //   onHand / available / reserved / noValidPickLocation —
  //                      operatorSummary.inventoryState, the canonical
  //                      whole-shop inventory_truth read model.
  //   notReceivedCount — variants with no inventory_truth row,
  //                      ProductsOperatorFacts.noInventoryCount.
  //   phantomCount     — variants whose summed on_hand < 0 (sold without
  //                      recorded receiving), ProductsOperatorFacts.phantomCount.
  const inventoryState: InventoryStateFacts = {
    onHandUnits: operatorSummary?.inventoryState?.onHandUnits ?? null,
    availableUnits: operatorSummary?.inventoryState?.availableUnits ?? null,
    reservedUnits: operatorSummary?.inventoryState?.reservedUnits ?? null,
    notReceivedCount: operatorSummary?.sellability?.blockedReasons?.noInventory ?? null,
    phantomCount: operatorSummary?.sellability?.blockedReasons?.phantom ?? null,
    noValidPickLocationCount: operatorSummary?.inventoryState?.noValidPickLocationCount ?? null,
    hasInventoryTruth: operatorSummary?.inventoryState?.hasInventoryTruth ?? null,
  };

  if (__DEV__) console.debug('[ProductsFT2Page] rendering intelligence tab', { props, operatorSummary });

  return (
    <ProductsModuleFT2
      {...props}
      operatorSummary={operatorSummary}
      currency={currency}
      mapContent={mapContent}
      inventoryState={inventoryState}
      inventoryStateStatus={inventoryStateStatus}
      onRetryInventoryState={() => { void operatorQuery.refetch(); }}
      suppressInventoryState={isOpsConsoleOpen}
      onExport={onExport}
    />
  );
}

function LegacyItemsRedirect({ defaultFilter }: { defaultFilter?: string }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  if (defaultFilter && !params.has('filter')) params.set('filter', defaultFilter);
  const query = params.toString();
  return <Navigate to={{ pathname: '/inventory/items', search: query ? `?${query}` : '', hash: location.hash }} replace />;
}

function LegacyDataQualityRedirect() {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: '/inventory', search, hash }} replace />;
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

        <Route path="/items"          element={<ProductsCatalogPage range={range} onChange={setRange} />} />
        <Route path="/catalog"        element={<LegacyItemsRedirect />} />
        <Route path="/costs"          element={<LegacyItemsRedirect defaultFilter="missing-cost" />} />
        <Route path="/data-quality"   element={<LegacyDataQualityRedirect />} />
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
