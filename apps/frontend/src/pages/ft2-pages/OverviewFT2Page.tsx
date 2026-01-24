import { useState } from 'react';
import { useOverviewModulesFt2Snapshot } from '../overview/useOverviewModulesFt2Snapshot';
import { OverviewModuleFT2 } from '@lasyncro/overview';
import type { FT2DateRange } from '@lasyncro/ui-ft2';
import { FT2DateRangeBar } from '@lasyncro/ui-ft2';
import { mapOverviewFt2Props } from 'pages/overview/useOverviewFt2Adapter';

export default function OverviewPageFT2() {
  const [range, setRange] = useState<FT2DateRange>({
    preset: 'past_30_days',
    from: null,
    to: null,
  });

  const overviewModules = useOverviewModulesFt2Snapshot(range);

  if (!overviewModules.isSuccess) return null;

  const overviewProps = mapOverviewFt2Props(overviewModules.data);

  return (
    <>
      <FT2DateRangeBar
        value={range}
        onChange={setRange}
      />

      <OverviewModuleFT2 {...overviewProps} />
    </>
  );
}

