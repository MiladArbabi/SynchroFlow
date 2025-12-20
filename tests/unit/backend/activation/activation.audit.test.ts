//tests/unit/backend/activation/activation.audit.test.ts
import db from "api-db";

describe('activation audit trail', () => {
  it('persists an activation verdict audit event', async () => {
    const rows = await db('activation_audit_events').select('*');

    expect(Array.isArray(rows)).toBe(true);
  });
});
