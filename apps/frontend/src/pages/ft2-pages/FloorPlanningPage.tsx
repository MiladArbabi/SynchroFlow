// apps/frontend/src/pages/ft2-pages/FloorPlanningPage.tsx
import { FloorPlanningModuleFT2 } from '@lasyncro/floor-planning';
import { useFloorPlanning } from '../floor-planning/useFloorPlanning';
import { useWarehouseGrid, useWarehouseGridOccupancy } from '../floor-planning/useWarehouseGrid';
import { useBinLog } from '../floor-planning/useBinLog';
import { useState } from 'react';
import { useBinStats } from 'pages/floor-planning/useBinStats';

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
  const { data, isLoading, isError, refetch } = useFloorPlanning();
  const { data: gridData, isLoading: isGridLoading } = useWarehouseGrid();
  const { data: occupancyData } = useWarehouseGridOccupancy(!isGridLoading);
  const { data: binLogData, isLoading: isBinLogLoading } = useBinLog(activeBinLog);
  const { data: binStatsData } = useBinStats(selectedBin);

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
    />
  );
}