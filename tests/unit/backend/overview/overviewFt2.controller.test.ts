// tests/unit/backend/overview/overviewFt2.controller.test.ts

import request from 'supertest';
import express from 'express';

import { authenticateToken } from 'api-src/middleware/auth.middleware';
import { getOverviewFt2 } from 'api-src/api/overview/overview.ft2.controller';

// ─────────────────────────────────────────────
// Mock Overview FT2 resolver
// ─────────────────────────────────────────────
jest.mock(
  'api-src/services/overview-ft2/overviewFt2.resolver',
  () => ({
    getOverviewFt2Snapshot: jest.fn(),
  })
);

import {
  getOverviewFt2Snapshot,
} from 'api-src/services/overview-ft2/overviewFt2.resolver';

describe('Overview FT2 Controller — HTTP semantics', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    // Mock auth — inject shopId
    app.use((req, _res, next) => {
      (req as any).user = { shopId: 1 };
      next();
    });

    app.get(
      '/api/v1/modules/overview/ft2',
      getOverviewFt2
    );
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('returns 204 No Content when resolver returns null (epistemic silence)', async () => {
    (getOverviewFt2Snapshot as jest.Mock).mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/modules/overview/ft2')
      .expect(204);

    // Hard guarantees
    expect(res.body).toEqual({});
    expect(res.text).toBe('');
  });
});