// apps/frontend/src/pages/AnalyticsFT2Page.tsx
//
// AnalyticsFT2Page
// ----------------
// FT2-only Analytics observability surface.

import { AnalyticsModuleFT2 } from '@lasyncro/analytics';
import { useAnalyticsFt2Snapshot } from './analytics/useAnalyticsFt2Snapshot';
import { mapAnalyticsFt2Props } from './analytics/useAnalyticsFt2Adapter';

const __DEV__ = import.meta.env.DEV;

export default function AnalyticsFT2Page() {
  const snapshotQuery = useAnalyticsFt2Snapshot(true);

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

  return <AnalyticsModuleFT2 {...props} />;
}