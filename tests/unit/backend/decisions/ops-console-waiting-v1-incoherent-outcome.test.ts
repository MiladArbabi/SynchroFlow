// tests/unit/backend/decisions/ops-console-waiting-v1-incoherent-outcome.test.ts
//
// OPS-CONSOLE-WAITING-01 — WAITING-09 REPLACEMENT (unit-level).
//
// The original WAITING-09 integration fixture (a hand-written
// order_constraints row with is_active=true AND resolved_at set) is
// rejected by a real DB trigger —
//   [PROJECTION_WRITE_VIOLATION] table=order_constraints must be written
//   only by projection.engine
// — confirmed by actually attempting the insert against the disposable
// synchroflow_test_* DB (see
// tests/integration/decisions/ops-console-waiting-v1-contract.test.ts's
// header). That state cannot be constructed as an integration fixture
// without bypassing a production safety invariant, which is out of scope
// for this RED-only correction pass.
//
// This file instead proves the SAME contract — an incoherent
// constraint_is_active=true WITH constraint_resolved_at set derives to
// canonical outcome 'unknown' — against the REAL, UNMODIFIED
// interventionOutcome.service.ts derivation. Only the DB READ that
// readOrderInterventionOutcomes() depends on (withTenant + the
// decision_interventions/order_constraints join) is mocked; deriveOutcome()
// itself is neither exported, re-implemented, nor duplicated here — it runs
// for real, against a synthetic row shaped exactly like the query result
// the rejected fixture would have produced had the trigger allowed it.
//
// NO PRODUCTION SOURCE IS ADDED OR CHANGED BY THIS FILE.

jest.mock('@lasyncro/backend-core/db.js', () => ({
  withTenant: (_shopId: number, fn: (trx: unknown) => Promise<unknown>) => fn(mockTrx),
}));

let mockRows: Record<string, unknown>[] = [];

/**
 * Minimal fluent stand-in for the exact Knex chain
 * readOrderInterventionOutcomes() calls:
 *   trx('decision_interventions as i').leftJoin(...).where(...).orderBy(...).orderBy(...).select(...)
 * Every link but the terminal `select` just returns the same builder;
 * `select` resolves with the synthetic rows for the test in progress.
 */
function mockQueryBuilder() {
  const qb: Record<string, unknown> = {
    leftJoin: () => qb,
    where: () => qb,
    orderBy: () => qb,
    select: () => Promise.resolve(mockRows),
  };
  return qb;
}

const mockTrx = (_table: string) => mockQueryBuilder();

import { readOrderInterventionOutcomes } from 'api-src/services/decision/interventionOutcome.service';

function incoherentRow(over: Record<string, unknown> = {}) {
  const occurredAt = new Date('2026-09-18T10:00:00.000Z');
  return {
    id: 'intv-incoherent-1',
    shop_id: 42,
    entity_id: 'order-incoherent-1',
    constraint_id: 'constraint-incoherent-1',
    treatment_key: 'inventory_reorder_intent',
    action_key: 'create_reorder_request',
    actor_type: 'user',
    actor_user_id: 7,
    source_surface: 'sourcing_targeted_reorder_queue',
    occurred_at: occurredAt,
    metadata: {},
    // THE incoherence under test: is_active=true WITH resolved_at set.
    constraint_is_active: true,
    constraint_resolved_at: new Date('2026-09-18T09:00:00.000Z'),
    constraint_started_at: occurredAt,
    constraint_order_id: 'order-incoherent-1',
    ...over,
  };
}

beforeEach(() => {
  mockRows = [];
});

describe('WAITING-09 (unit replacement) — incoherent constraint_is_active=true WITH constraint_resolved_at set', () => {
  it('derives canonical outcome=\'unknown\' through the real, unmodified deriveOutcome branch (item 9)', async () => {
    mockRows = [incoherentRow()];

    const result = await readOrderInterventionOutcomes({
      shopId: 42,
      lasyncroOrderId: 'order-incoherent-1',
    });

    expect(result).toHaveLength(1);
    expect(result[0].outcome).toEqual(
      expect.objectContaining({
        status: 'unknown',
        constraintIsActive: true,
        constraintResolvedAt: expect.any(Date),
        resolutionLatencyMs: null,
      })
    );
  });

  /**
   * Harness sanity check — NOT itself part of item 9. Proves the mock query
   * builder is not silently biasing every result toward 'unknown': the same
   * harness, given a COHERENT active+unresolved row, must still derive
   * 'pending_verification' exactly as the real WAITING-01/02 integration
   * fixtures do. Without this, a broken mock returning the SAME synthetic
   * shape for every call could pass the test above for the wrong reason.
   */
  it('a coherent active+unresolved row still derives \'pending_verification\' (harness sanity check, not item 9 itself)', async () => {
    mockRows = [incoherentRow({ constraint_resolved_at: null })];

    const result = await readOrderInterventionOutcomes({
      shopId: 42,
      lasyncroOrderId: 'order-incoherent-1',
    });

    expect(result[0].outcome).toEqual(
      expect.objectContaining({
        status: 'pending_verification',
        constraintIsActive: true,
        constraintResolvedAt: null,
      })
    );
  });
});
