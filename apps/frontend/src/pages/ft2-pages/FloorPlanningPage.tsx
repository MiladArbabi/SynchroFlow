// apps/frontend/src/pages/ft2-pages/FloorPlanningPage.tsx
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { axiosInstance } from 'api/axiosConfig';
import { FloorPlanningModuleFT2 } from '@lasyncro/floor-planning';
import { useFloorPlanning } from '../floor-planning/useFloorPlanning';
import { useWarehouseGrid, useWarehouseGridOccupancy } from '../floor-planning/useWarehouseGrid';
import { useBinLog } from '../floor-planning/useBinLog';
import { useBinStats } from '../floor-planning/useBinStats';
import { useCreateZone, useDeleteZone, useUpdateZone, useUpdateProductBarcode } from '../floor-planning/useZoneManagement';

/**
 * FLOOR PLANNING GATE PAGE
 * -------------------------
 * Orchestrates three independent data fetches:
 *   1. useFloorPlanning     — zones + barcodes (Setup / Barcodes tabs)
 *   2. useWarehouseGrid     — bin locations for grid layout (Map tab)
 *   3. useWarehouseGridOccupancy — per-bin stock, lazy after grid ready
 *
 * All HTTP calls live here — FloorPlanningModuleFT2 module stays decoupled.
 */
export default function FloorPlanningPage() {
  const [activeBinLog, setActiveBinLog]   = useState<string | undefined>();
  const [selectedBin, setSelectedBin]     = useState<string | undefined>();
  const [searchParams, setSearchParams] = useSearchParams();
  const variantId = searchParams.get('variantId');
  const activeTab = (searchParams.get('tab') as 'map' | 'setup' | 'barcodes') ?? 'map';
  const activeView = (searchParams.get('view') as 'list' | 'canvas') ?? 'list';
  const activeSubTab = (searchParams.get('subTab') as 'locations' | 'products') ?? 'locations';
  const [variantFocusBins, setVariantFocusBins] = useState<string[]>([]);

  const { data, isLoading, isError, refetch } = useFloorPlanning();
  const { data: gridData, isLoading: isGridLoading } = useWarehouseGrid();
  const { data: occupancyData } = useWarehouseGridOccupancy(!isGridLoading);
  const { data: binLogData, isLoading: isBinLogLoading } = useBinLog(activeBinLog);
  const { data: binStatsData } = useBinStats(selectedBin);
  const createZone    = useCreateZone();
  const deleteZone    = useDeleteZone();
  const updateZone           = useUpdateZone();
  const updateProductBarcode = useUpdateProductBarcode();

  useEffect(() => {
    if (!variantId) { setVariantFocusBins([]); return; }
    axiosInstance.get(`/api/v1/floor-planning/variant/${variantId}/bins`)
      .then(r => setVariantFocusBins(r.data.bins.map((b: { location_code: string }) => b.location_code)))
      .catch(() => setVariantFocusBins([]));
  }, [variantId]);

  return (
    <FloorPlanningModuleFT2
      data={data ?? null}
      isLoading={isLoading}
      isError={isError}
      onRefresh={refetch}
      gridLocations={gridData?.locations}
      gridOccupancy={occupancyData?.occupancy}
      isGridLoading={isGridLoading}
      binLog={binLogData}
      isBinLogLoading={isBinLogLoading}
      onBinLogOpen={setActiveBinLog}
      binStats={binStatsData}
      onBinSelect={setSelectedBin}
      variantFocusBins={variantFocusBins.length > 0 ? variantFocusBins : undefined}
      onCreateZone={(payload) => createZone.mutateAsync(payload)}
      onDeleteZone={(code) => deleteZone.mutateAsync(code)}
      onToggleZoneActive={(code, active) => updateZone.mutateAsync({ locationCode: code, active })}
      onUpdateZone={(code, payload) => updateZone.mutateAsync({ locationCode: code, ...payload })}
      onUpdateProductBarcode={(variantId, barcode) => updateProductBarcode.mutateAsync({ lasyncroVariantId: variantId, barcode })}
      activeTab={activeTab}
      onTabChange={(tab) => setSearchParams(prev => { prev.set('tab', tab); return prev; })}
      activeView={activeView}
      onViewChange={(view) => setSearchParams(prev => { prev.set('view', view); return prev; })}
      activeSubTab={activeSubTab}
      onSubTabChange={(subTab) => setSearchParams(prev => { prev.set('subTab', subTab); return prev; })}
    />
  );
}