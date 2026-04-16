// apps/frontend/src/pages/ft2-pages/FloorPlanningPage.tsx
import { FloorPlanningModuleFT2 } from '@lasyncro/floor-planning';
import { useFloorPlanning } from '../floor-planning/useFloorPlanning';

/**
 * FLOOR PLANNING GATE PAGE
 * -------------------------
 * Thin wrapper — data fetching via useFloorPlanning hook,
 * injected as props into the dumb FloorPlanningPage module component.
 *
 * All HTTP calls live here — module stays decoupled.
 */
export default function FloorPlanningPage() {
  const { data, isLoading, isError, refetch } = useFloorPlanning();

  return (
    <FloorPlanningModuleFT2
      data={data ?? null}
      isLoading={isLoading}
      isError={isError}
      onRefresh={refetch}
    />
  );
}