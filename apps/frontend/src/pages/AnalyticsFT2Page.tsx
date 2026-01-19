// apps/frontend/src/pages/AnalyticsFT2Page.tsx
//
// AnalyticsFT2Page
// ----------------
// FT2-only Analytics observability surface.
import { useState } from 'react';
import { FT2DateRangeBar } from '@lasyncro/ui-ft2';
import type { FT2DateRange } from '@lasyncro/ui-ft2';

import { AnalyticsModuleFT2 } from '@lasyncro/analytics';
import { useAnalyticsFt2Snapshot } from './analytics/useAnalyticsFt2Snapshot';
import { mapAnalyticsFt2Props } from './analytics/useAnalyticsFt2Adapter';

const __DEV__ = import.meta.env.DEV;

export default function AnalyticsFT2Page() {
  const [range, setRange] = useState<FT2DateRange>({
    preset: 'past_7_days',
    from: null,
    to: null,
  });

  // NOTE:
  // Date range is resolved by lifecycle/controller.
  // Analytics observes already-scoped truth.
  // This hook does NOT imply Analytics owns time.
  const snapshotQuery = useAnalyticsFt2Snapshot(range);


  if (!snapshotQuery.isSuccess) {
    if (__DEV__) {
      console.debug('[AnalyticsFT2Page] awaiting FT2 snapshot');
    }
    return <div>Loading analytics insights…</div>;
  }

  const props = mapAnalyticsFt2Props(snapshotQuery.data);

  if (__DEV__) {
    console.debug('[AnalyticsFT2Page] rendering AnalyticsModuleFT2', props);
  }

  return (
    <>
      <FT2DateRangeBar
        value={range}
        onChange={setRange}
      />

      <AnalyticsModuleFT2 {...props} />
    </>
  );
}