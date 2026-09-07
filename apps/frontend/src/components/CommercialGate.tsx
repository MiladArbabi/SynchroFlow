// apps/frontend/src/components/CommercialGate.tsx
//
// CommercialGate (COMMERCIAL-ACCESS-ARCH-01 P0-A2B)
// ---------------------------------------------------
// Reusable frontend ROUTE gate. A direct URL must resolve the SAME
// commercial-access decision as the nav/tab click for the same destination —
// this is the mechanism module route subtrees adopt to guarantee that.
//
// Usage:
//   <CommercialGate capabilityId="warehouse.analytics">
//     <WmsAnalyticsPage />
//   </CommercialGate>
//
// ALLOW  -> render children.
// DENY   -> children are NOT rendered; a decision-aware UpgradePrompt renders
//           in their place.
// Unresolved entitlement state -> render nothing (never flash protected
// content while the shop's tier/snapshot has not resolved yet).
//
// Decision source: the SAME shared adapter (runtime/commercialContext) Sidenav
// and ModuleTabBar consume — never a locally re-evaluated rule.

import React from 'react';
import { useCommercialAccess } from 'runtime/commercialContext';
import { UpgradePrompt } from './UpgradePrompt';
import { getCapabilityPresentation } from '../commercial/capabilityPresentation';
import type { CapabilityId } from '@lasyncro/commercial-policy';

export interface CommercialGateProps {
  capabilityId: CapabilityId;
  children: React.ReactNode;
  /** Denial presentation — defaults to a full-container empty state. */
  mode?: 'locked' | 'teased';
  featureName?: string;
  featureBlurb?: string;
}

export const CommercialGate: React.FC<CommercialGateProps> = ({
  capabilityId,
  children,
  mode = 'locked',
  featureName,
  featureBlurb,
}) => {
  const { decide, isResolved } = useCommercialAccess();

  // Never flash protected content while the entitlement snapshot is still
  // resolving — treat "unresolved" as "not yet allowed", not "denied".
  // A decision source that does not report resolution state (e.g. a test
  // double) is treated as already resolved.
  if (isResolved === false) return null;

  const decision = decide(capabilityId);

  if (decision.allowed) {
    return <>{children}</>;
  }

  const presentation = getCapabilityPresentation(capabilityId);
  const resolvedFeatureName = featureName ?? presentation?.featureName;
  const resolvedBenefits = featureName === undefined || featureName === presentation?.featureName
    ? presentation?.benefits
    : undefined;

  return (
    <UpgradePrompt
      decision={decision}
      mode={mode}
      featureName={resolvedFeatureName}
      benefits={resolvedBenefits}
      featureBlurb={featureBlurb}
      open
    >
      {mode === 'teased' ? children : undefined}
    </UpgradePrompt>
  );
};

export default CommercialGate;
