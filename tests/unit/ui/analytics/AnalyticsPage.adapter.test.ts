//tests/unit/ui/analytics/AnalyticsPage.adapter.test.ts

import { mapAnalyticsFt1Props } from 'pages/analytics/useAnalyticsFt1Adapter';

describe('mapAnalyticsFt1Props', () => {
  it('maps missing signals to null', () => {
    const props = mapAnalyticsFt1Props({
      modules: [
        {
          moduleId: 'analytics',
          signals: [],
        },
      ],
    });

    expect(props).toEqual({
      orderCount: null,
      productCount: null,
      baseSignalsReady: null,
    });
  });

  it('preserves zero vs null correctly', () => {
    const props = mapAnalyticsFt1Props({
      modules: [
        {
          moduleId: 'analytics',
          signals: [
            { name: 'analytics.orderCount', value: 0 },
            { name: 'analytics.productCount', value: 5 },
            { name: 'analytics.baseSignalsReady', value: false },
          ],
        },
      ],
    });

    expect(props).toEqual({
      orderCount: 0,
      productCount: 5,
      baseSignalsReady: false,
    });
  });
});
