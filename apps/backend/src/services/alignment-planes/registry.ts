import type { AlignmentPlane } from './alignmentPlane.types';
import { demandRealityPlane } from './demandReality.plane';
import { engagementRevenuePlane } from './planes/engagementRevenue.plane';
import { operationalEconomicPlane } from './planes/operationalEconomic.plane';

/**
 * Alignment Plane Registry
 * -----------------------
 * Explicit wiring only.
 */
export const alignmentPlaneRegistry: AlignmentPlane<any>[] = [
  demandRealityPlane,
  engagementRevenuePlane,
  operationalEconomicPlane,
];
