// apps/frontend/src/pages/ft2-pages/FloorPlanningPage.tsx
import { useState, useEffect } from 'react';
import { Box } from '@mui/material';
import { useActivationChecklist } from '../../hooks/useActivationChecklist';
import { useSearchParams } from 'react-router-dom';
import { axiosInstance } from 'api/axiosConfig';
import { AxiosError } from 'axios';
import { printViaQz } from 'utils/qzPrint';
import { FloorPlanningModuleFT2 } from '@lasyncro/floor-planning';
import type { FloorPlanningMode, PrintSubmitResult } from '@lasyncro/floor-planning';
import useConfig from 'hooks/useConfig';
import { useFloorPlanning } from '../floor-planning/useFloorPlanning';
import { useWarehouseGrid, useWarehouseGridOccupancy } from '../floor-planning/useWarehouseGrid';
import { useBinLog } from '../floor-planning/useBinLog';
import { useBinStats } from '../floor-planning/useBinStats';
import { 
  useCreateZone, 
  useDeleteZone,
  useDeleteZones,
  useDuplicateZones,
  useUpdateZone,
  useUpdateZonePositions,
  usePrintBarcode,
  useBatchPrintBarcodes,
} from '../floor-planning/useZoneManagement';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { CommercialGate } from '../../components/CommercialGate';
import { WAREHOUSE_MODULE_TABS } from './warehouseModuleTabs';

/**
 * FLOOR PLANNING GATE PAGE
 * -------------------------
 * Orchestrates three independent data fetches:
 *   1. useFloorPlanning     — zones (Edit layout + location labels)
 *   2. useWarehouseGrid     — bin locations for the spatial workspace
 *   3. useWarehouseGridOccupancy — per-bin stock, lazy after grid ready
 *
 * All HTTP calls live here — FloorPlanningModuleFT2 module stays decoupled.
 *
 * One canonical workspace: inspection by default, Edit layout on demand.
 * Legacy deep links (?tab=setup&view=canvas, used by onboarding, Overview,
 * Orders, Products and WMS) still enter Edit layout; every other retired
 * tab / subTab resolves to inspection.
 */
export default function FloorPlanningPage() {
  const { minimumMappingReady } = useActivationChecklist();
  const [activeBinLog, setActiveBinLog]   = useState<string | undefined>();
  const [selectedBin, setSelectedBin]     = useState<string | undefined>();
  const [searchParams, setSearchParams] = useSearchParams();
  const variantId = searchParams.get('variantId');
  const mode: FloorPlanningMode = searchParams.get('tab') === 'setup' ? 'edit' : 'inspect';
  // Shared Ops Console owns attention while open — same app-level state as
  // Overview / Orders / Products; the module only withdraws its rail.
  const { state: { isOpsConsoleOpen } } = useConfig();
  const [variantFocusBins, setVariantFocusBins] = useState<string[]>([]);

  const { data, isLoading, isError, refetch } = useFloorPlanning();
  const { data: gridData, isLoading: isGridLoading } = useWarehouseGrid();
  const { data: occupancyData } = useWarehouseGridOccupancy(!isGridLoading);
  const printBarcode  = usePrintBarcode();
  const batchPrintBarcodes = useBatchPrintBarcodes();
  const { data: binLogData, isLoading: isBinLogLoading } = useBinLog(activeBinLog);
  const { data: binStatsData } = useBinStats(selectedBin);
  const createZone    = useCreateZone();
  const deleteZone    = useDeleteZone();
  const deleteZones    = useDeleteZones();
  const duplicateZones = useDuplicateZones();
  const updateZone           = useUpdateZone();
  const updateZonePositions  = useUpdateZonePositions();

  useEffect(() => {
    if (!variantId) { setVariantFocusBins([]); return; }
    axiosInstance.get(`/api/v1/floor-planning/variant/${variantId}/bins`)
      .then(r => setVariantFocusBins(r.data.bins.map((b: { location_code: string }) => b.location_code)))
      .catch(() => setVariantFocusBins([]));
  }, [variantId]);

  // Edit layout keeps the existing ?tab=setup&view=canvas URL; returning to
  // inspection clears the retired tab params (variantId is preserved).
  const handleModeChange = (next: FloorPlanningMode) => setSearchParams(prev => {
    prev.delete('tab'); prev.delete('view'); prev.delete('subTab');
    if (next === 'edit') { prev.set('tab', 'setup'); prev.set('view', 'canvas'); }
    return prev;
  });

  // SHOP-REVIEW-BARCODE-PRINT-05: generate the label PDF, attempt optional QZ
  // dispatch, and hand the label preview a discriminated outcome. The UI owns all
  // browser-tab / download behaviour — this page never calls window.open.
  const submitPrint = async (
    fetchBlob: () => Promise<Blob>,
    role: 'location_label' | 'product_label',
  ): Promise<PrintSubmitResult> => {
    let blob: Blob;
    try {
      blob = await fetchBlob();
    } catch (err) {
      const status = err instanceof AxiosError ? err.response?.status : undefined;
      if (status === 400 || status === 404) return { outcome: 'empty' };
      return { outcome: 'error', message: 'Could not generate the labels. Please try again.' };
    }
    const dispatch = await printViaQz(blob, role, axiosInstance);
    if (dispatch.status === 'dispatched') {
      return { outcome: 'dispatched', printerName: dispatch.printerName };
    }
    return { outcome: 'browser', blob, reason: dispatch.reason };
  };

  return (
    // COMMERCIAL-ACCESS-ARCH-01 P0-A2B: warehouse.floor_planning (Growth+) gate
    // — a direct URL into /floor-planning/* must not bypass this.
    <CommercialGate capabilityId="warehouse.floor_planning">
      <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Warehouse-level tab bar — mirrors WmsPage and WmsAnalyticsPage */}
        {/* Warehouse-level tab bar — shared definition, see warehouseModuleTabs.ts.
            Previously a local duplicate (ISS-P21 follow-up, 2026-07-14) —
            consolidated to prevent tier-label drift recurring a fourth time. */}
        <Box sx={{ flexShrink: 0 }}>
          <ModuleTabBar tabs={WAREHOUSE_MODULE_TABS} />
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <FloorPlanningModuleFT2
            data={data ?? null}
            minimumMappingReady={minimumMappingReady}
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
            onDeleteZones={(codes) => deleteZones.mutateAsync(codes)}
            onDuplicateZones={(payload) => duplicateZones.mutateAsync(payload)}
            onUpdateZone={(code, payload) => updateZone.mutateAsync({ locationCode: code, ...payload })}
            onUpdateZonePositions={(positions) => updateZonePositions.mutateAsync(positions)}
            onPrintBarcode={(locationCode) => printBarcode.mutateAsync(locationCode)}
            // SHOP-REVIEW-BARCODE-PRINT-05: PDF → optional QZ dispatch → discriminated
            // outcome. No window.open here; the label preview renders the result and
            // owns the durable browser Open/Download recovery.
            onBatchPrintBarcodes={(locationCodes, formatId) =>
              submitPrint(() => batchPrintBarcodes.mutateAsync({ locationCodes, formatId }), 'location_label')
            }
            mode={mode}
            onModeChange={handleModeChange}
            suppressLocationRail={isOpsConsoleOpen}
          />
        </Box>
      </Box>
    </CommercialGate>
  );
}
