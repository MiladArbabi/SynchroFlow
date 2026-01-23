// apps/frontend/src/pages/OverviewFT2Page.tsx
//
// OverviewFT2Page
// ----------------
// FT2-only Reality Overview surface.
//
// HARD CONTRACT:
// - MUST render ROOverviewModuleFT2 only
// - MUST NOT infer lifecycle
// - MUST NOT adapt data inline
// - MUST block render until snapshot is available

import { OverviewModuleFT2 } from '@lasyncro/overview'
import { mapOverviewFt2Props } from './overview/useOverviewAdapter';
import { useOverviewSnapshot } from './overview/useOverviewSnapshot';

const __DEV__ = import.meta.env.DEV;

export default function OverviewFT2Page() {
  const snapshotQuery = useOverviewSnapshot();

  if (snapshotQuery.isLoading) {
   if (__DEV__) {
     console.debug('[OverviewFT2Page] loading Overview FT2 snapshot');
   }
   return <div>Loading reality overview…</div>;
 }

 if (snapshotQuery.isError) {
   if (__DEV__) {
     console.debug(
       '[OverviewFT2Page] Overview FT2 blocked',
       snapshotQuery.error
     );
   }

   return (
     <div>
       Reality overview is currently unavailable.
     </div>
   );
 }

  const props = mapOverviewFt2Props(snapshotQuery.data);

  if (__DEV__) {
    console.debug('[OverviewFT2Page] rendering OverviewModuleFT2', props);
  }

  return <OverviewModuleFT2 {...props} />;
}