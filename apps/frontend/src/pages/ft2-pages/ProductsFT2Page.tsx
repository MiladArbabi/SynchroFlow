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

import { Routes, Route, Navigate } from 'react-router-dom';
import { useState } from 'react';
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

const __DEV__ = import.meta.env.DEV;

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
        <Route path="/" element={(() => {
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
              currency={{ displayCurrency, locale, rates }}
              onExport={async () => setExportDrawerOpen(true)}
            />
          );
        })()} />

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