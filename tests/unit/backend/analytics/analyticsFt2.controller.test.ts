// tests/unit/backend/analytics/analyticsFt2.controller.test.ts

import { analyticsFt2Controller } from 'api-src/api/analytics/analytics.ft2.controller';
import * as provider from 'api-src/services/analytics-ft2.provider';
import * as periodUtil from 'api-src/utils/ft2Period';

describe('Analytics FT2 Controller (RED)', () => {
  const mockRes = () => {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 if shopId is missing', async () => {
    const req: any = { user: undefined };
    const res = mockRes();

    await analyticsFt2Controller(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  it('does NOT accept query-based period (FT2 violation)', async () => {
    const req: any = {
      user: { shopId: 1 },
      query: { from: '2020-01-01', to: '2020-01-31' },
    };
    const res = mockRes();

    jest.spyOn(periodUtil, 'getFt2Period').mockReturnValue({
      from: 'AUTO_FROM',
      to: 'AUTO_TO',
    });

    jest.spyOn(provider, 'getAnalyticsFt2Snapshot').mockResolvedValue({
      context: {},
      outcome: null,
      trend: null,
    } as any);

    await analyticsFt2Controller(req, res);

    expect(periodUtil.getFt2Period).toHaveBeenCalled();
    expect(provider.getAnalyticsFt2Snapshot).toHaveBeenCalledWith({
      shopId: 1,
    });
  });

  it('never reads req.query for FT2 period', async () => {
    const req: any = {
      user: { shopId: 42 },
      query: { from: 'HACK', to: 'HACK' },
    };
    const res = mockRes();

    const periodSpy = jest.spyOn(periodUtil, 'getFt2Period').mockReturnValue({
      from: 'CANON_FROM',
      to: 'CANON_TO',
    });

    jest.spyOn(provider, 'getAnalyticsFt2Snapshot').mockResolvedValue({
      context: {},
      outcome: null,
      trend: null,
    } as any);

    await analyticsFt2Controller(req, res);

    expect(periodSpy).toHaveBeenCalledTimes(1);
  });
});