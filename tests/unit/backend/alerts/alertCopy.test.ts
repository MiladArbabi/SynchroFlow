// tests/unit/backend/alerts/alertCopy.test.ts
//
// OV-DATA-02 — alert-copy contract (OV-SEM correction).
//
// Locks the canonical merchant-facing wording for the two shop-level alerts
// surfaced in the Overview "Needs a decision" panel. Asserts contractual
// terminology and count semantics only — not incidental prose.

import {
  buildSlaBreachAlertCopy,
  buildBlockedRevenueAlertCopy,
} from 'api-src/services/alerts/alerts.copy';

describe('alert copy — OV-SEM final contract', () => {
  describe('OV-SEM-02 — SLA breach copy uses "Fulfillment SLA" terminology', () => {
    const { title, message } = buildSlaBreachAlertCopy(2, 26493);

    it('active SLA title names the "Fulfillment SLA"', () => {
      expect(title).toContain('Fulfillment SLA');
    });

    it('active SLA copy never says "shipping SLA"', () => {
      expect(title).not.toMatch(/shipping SLA/i);
      expect(message).not.toMatch(/shipping SLA/i);
    });

    it('active SLA copy uses no CPT / carrier-pickup terminology', () => {
      const combined = `${title} ${message}`;
      expect(combined).not.toMatch(/\bCPT\b/);
      expect(combined).not.toMatch(/carrier pick-?up/i);
    });
  });

  describe('OV-SEM-03 — blocked-order copy leads with the count, carries no revenue amount', () => {
    const blockedRevenue = 11404;
    const amount = `$${Math.round(blockedRevenue).toLocaleString()}`;

    it('blocked title is the blocked-order count (plural): "2 orders blocked"', () => {
      expect(buildBlockedRevenueAlertCopy(2, blockedRevenue).title).toBe('2 orders blocked');
    });

    it('blocked title is the blocked-order count (singular): "1 order blocked"', () => {
      expect(buildBlockedRevenueAlertCopy(1, 5000).title).toBe('1 order blocked');
    });

    it('blocked title contains no revenue amount', () => {
      const { title } = buildBlockedRevenueAlertCopy(2, blockedRevenue);
      expect(title).not.toContain('$');
      expect(title).not.toContain(amount);
    });

    it('blocked message contains no revenue amount', () => {
      const { message } = buildBlockedRevenueAlertCopy(2, blockedRevenue);
      expect(message).not.toContain('$');
      expect(message).not.toContain(amount);
    });
  });
});
