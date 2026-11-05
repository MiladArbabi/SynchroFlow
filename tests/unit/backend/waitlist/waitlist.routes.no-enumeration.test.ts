/**
 * MARKETING-P0-IMPLEMENT-002 — waitlist signup contract (protects existing
 * behaviour; the route is unchanged by this issue).
 *
 * - A duplicate email is persisted idempotently (INSERT … ON CONFLICT (email)
 *   DO NOTHING) and answered exactly like a new signup, so the public API
 *   cannot be used to enumerate existing emails. Client analytics therefore
 *   records "accepted" submissions; unique signups are counted from
 *   waitlist_signups.
 * - Invalid input and DB failure are distinguishable from success.
 *
 * DB-free: systemQuery is mocked at the backend-core boundary. RESEND_API_KEY
 * is unset and fetch is spied on to prove no email is sent (SAFE-06).
 */
import express from 'express';
import request from 'supertest';

const mockSystemQuery = jest.fn();
const builderCalls: Array<{ method: string; args: unknown[] }> = [];

jest.mock('@lasyncro/backend-core/db.js', () => {
  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ['insert', 'onConflict', 'ignore']) {
    builder[method] = (...args: unknown[]) => {
      builderCalls.push({ method, args });
      return builder;
    };
  }
  const db = (table: string) => {
    builderCalls.push({ method: 'table', args: [table] });
    return builder;
  };
  return {
    __esModule: true,
    default: db,
    systemQuery: (...args: unknown[]) => mockSystemQuery(...args),
  };
  // virtual: the boundary is fully replaced, so no workspace build is needed.
}, { virtual: true });

// eslint-disable-next-line @typescript-eslint/no-var-requires
const waitlistRouter = require('api-src/api/waitlist/waitlist.routes').default;

function app() {
  const server = express();
  server.use(express.json());
  server.use('/api/v1/waitlist', waitlistRouter);
  return server;
}

const ORIGINAL_RESEND = process.env.RESEND_API_KEY;
let fetchSpy: jest.SpyInstance;

beforeEach(() => {
  delete process.env.RESEND_API_KEY;
  mockSystemQuery.mockReset();
  builderCalls.length = 0;
  fetchSpy = jest.spyOn(globalThis, 'fetch' as never).mockImplementation((() =>
    Promise.reject(new Error('network disabled in test'))) as never);
});

afterEach(() => {
  fetchSpy.mockRestore();
  if (ORIGINAL_RESEND === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = ORIGINAL_RESEND;
});

describe('POST /api/v1/waitlist — no email enumeration', () => {
  test('new and duplicate signups receive byte-identical responses', async () => {
    // New email: the insert affects one row.
    mockSystemQuery.mockResolvedValueOnce([{ id: 1 }]);
    const created = await request(app())
      .post('/api/v1/waitlist')
      .send({ email: 'merchant@example.com', source: 'launch_home' });

    // Same email again: ON CONFLICT DO NOTHING affects no rows.
    mockSystemQuery.mockResolvedValueOnce([]);
    const duplicate = await request(app())
      .post('/api/v1/waitlist')
      .send({ email: 'merchant@example.com', source: 'launch_home' });

    expect(created.status).toBe(200);
    expect(duplicate.status).toBe(created.status);
    expect(duplicate.text).toBe(created.text);
    expect(created.body).toEqual({ success: true });
  });

  test('persistence is idempotent on email (ON CONFLICT (email) DO NOTHING)', async () => {
    mockSystemQuery.mockResolvedValueOnce([]);
    await request(app()).post('/api/v1/waitlist').send({ email: 'merchant@example.com' });

    expect(builderCalls).toEqual([
      { method: 'table', args: ['waitlist_signups'] },
      {
        method: 'insert',
        args: [{ email: 'merchant@example.com', store_url: null, source: 'landing_page' }],
      },
      { method: 'onConflict', args: ['email'] },
      { method: 'ignore', args: [] },
    ]);
    expect(mockSystemQuery).toHaveBeenCalledTimes(1);
  });

  test('invalid email is rejected without touching the DB', async () => {
    const res = await request(app()).post('/api/v1/waitlist').send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(mockSystemQuery).not.toHaveBeenCalled();
  });

  test('DB failure is a 500, so clients do not record an accepted submission', async () => {
    mockSystemQuery.mockRejectedValueOnce(new Error('db down'));
    const spyError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await request(app()).post('/api/v1/waitlist').send({ email: 'merchant@example.com' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Server error' });
    spyError.mockRestore();
  });

  test('no notification email is sent without RESEND_API_KEY', async () => {
    mockSystemQuery.mockResolvedValueOnce([{ id: 1 }]);
    await request(app()).post('/api/v1/waitlist').send({ email: 'merchant@example.com' });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
