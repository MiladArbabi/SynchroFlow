// apps/backend/src/services/trial-expiry.service.ts
//
// Trial Expiry Service (MON-07)
// ------------------------------
// Runs on a schedule. Finds shops whose Growth trial has expired
// and downgrades them to Starter.
//
// Downgrade sequence (atomic per shop):
//   1. Update shop_subscriptions: tier → 'starter', status → 'active'
//   2. Revoke Growth-only entitlements via EntitlementRevocationService
//   3. Seed Starter entitlements via EntitlementsService
//
// HARD RULES:
//   - Per-shop failures are isolated — never crash the cycle
//   - Idempotent: re-running on an already-downgraded shop is a no-op
//   - No direct entitlement deletes — revocation via valid_until only

import db, {
  runWithTenantContext,
  systemQuery,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { getTierConfig } from '@lasyncro/backend-core/config/tiers.js';
import { EntitlementRevocationService } from './entitlement-revocation.service.js';
import { EntitlementsService } from '@lasyncro/backend-core/services/entitlements.service.js';
import { sendTrialExpiryEmail, sendTrialReminderEmail } from './email/email.service.js';
import { captureEvent } from '../utils/analytics.js';

/**
 * Downgrade a single shop from Growth trial to Starter.
 * Called when trial_ends_at < NOW() and status = 'trialing'.
 */
async function downgradeTrialShop(shopId: number): Promise<void> {
  const starterConfig = getTierConfig('starter');
  const growthConfig = getTierConfig('growth');

  // Modules present in Growth but NOT in Starter — revoke only these
  const starterModuleSet = new Set(starterConfig.modules);
  const modulesToRevoke = growthConfig.modules.filter((m) => !starterModuleSet.has(m));
  const flagsToRevoke = [...growthConfig.flags];

  await withTenant(shopId, async (trx) => {
    // 1. Downgrade subscription record
    const updated = await trx('shop_subscriptions')
      .where({ shop_id: shopId, status: 'trialing' })
      .update({
        tier: 'starter',
        status: 'active',
        trial_ends_at: null,
        updated_at: new Date(),
      });

    // Already downgraded — idempotent exit
    if (updated === 0) return;

    // 2. Revoke Growth-only entitlements
    if (modulesToRevoke.length > 0 || flagsToRevoke.length > 0) {
      await EntitlementRevocationService.revokeEntitlements({
        shopId,
        scope: {
          modules: modulesToRevoke as string[],
          flags: flagsToRevoke as string[],
        },
        reason: 'trial_expired',
      });
    }

    // 3. Seed Starter entitlements (additive, idempotent)
    const starterRows = starterConfig.modules.map((moduleKey) => ({
      shop_id: shopId,
      module_key: moduleKey,
      flag_key: null as string | null,
      source: 'trial_expiry:downgrade_to_starter',
    }));

    await EntitlementsService.applyFromCommercialGrant(trx, starterRows);
  });

console.log('[trial-expiry] shop downgraded to starter', { shopId });

  /**
   * PH-03: trial_expired — fires after successful downgrade.
   * Fire-and-forget — never block the expiry cycle.
   */
  captureEvent({
    shopId,
    event: 'trial_expired',
    properties: {
      downgraded_to: 'starter',
    },
  });

  // 4. Send expiry email — non-fatal
  try {
    const user = await withTenant(shopId, (trx) =>
      trx('users')
        .where({ shop_id: shopId })
        .orderBy('created_at', 'asc')
        .first('email', 'first_name')
    );

    if (user) {
      await sendTrialExpiryEmail({ toEmail: user.email, firstName: user.first_name ?? 'there' });
    }
  } catch (err) {
    console.error('[trial-expiry] expiry email failed (non-fatal)', { shopId, err });
  }
}

/**
 * Send D-3 and D-1 reminder emails to shops approaching trial expiry.
 */
async function sendTrialReminders(): Promise<void> {
  const now = new Date();
  const tenantResult = await systemQuery(
    db.raw('SELECT * FROM public.list_trialing_tenants()')
  );
  const trialingTenants: Array<{ shop_id: number; trial_ends_at: Date }> =
    tenantResult.rows;

  for (const daysLeft of [3, 1]) {
    const windowStart = new Date(now.getTime() + (daysLeft - 1) * 24 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + daysLeft * 24 * 60 * 60 * 1000);

    const shops = trialingTenants.filter((row) => {
      const endsAt = new Date(row.trial_ends_at);
      return endsAt >= windowStart && endsAt <= windowEnd;
    });

    for (const row of shops) {
      try {
        const user = await withTenant(row.shop_id, (trx) =>
          trx('users')
            .where({ shop_id: row.shop_id })
            .orderBy('created_at', 'asc')
            .first('email', 'first_name')
        );

        if (user) {
          await sendTrialReminderEmail({
            toEmail: user.email,
            firstName: user.first_name ?? 'there',
            daysLeft,
            trialEndsAt: row.trial_ends_at,
          });
          console.log('[trial-expiry] reminder sent', { shopId: row.shop_id, daysLeft });

          /**
           * PH-03: trial_reminder_sent — fires per shop per reminder window.
           * Tells PostHog which shops received reminders vs converted.
           */
          captureEvent({
            shopId: row.shop_id,
            event: 'trial_reminder_sent',
            properties: {
              days_left: daysLeft,
            },
          });
        }
      } catch (err) {
        console.error('[trial-expiry] reminder email failed (non-fatal)', { shopId: row.shop_id, daysLeft, err });
      }
    }
  }
}

/**
 * Main cycle — called by the worker on each poll interval.
 */
export async function runTrialExpiryCycle(): Promise<void> {
  // --- Expire trials ---
  const tenantResult = await systemQuery(
    db.raw('SELECT * FROM public.list_trialing_tenants()')
  );
  const expiredShops: Array<{ shop_id: number }> = tenantResult.rows.filter(
    (row: { trial_ends_at: Date }) => new Date(row.trial_ends_at) < new Date()
  );

  for (const row of expiredShops) {
    try {
      await runWithTenantContext(row.shop_id, () =>
        downgradeTrialShop(row.shop_id)
      );
    } catch (err) {
      console.error('[trial-expiry] downgrade failed (isolated)', {
        shopId: row.shop_id,
        err: err instanceof Error ? err.message : err,
      });
    }
  }

  // --- Send reminders ---
  try {
    await sendTrialReminders();
  } catch (err) {
    console.error('[trial-expiry] reminder cycle failed (non-fatal)', {
      err: err instanceof Error ? err.message : err,
    });
  }
}
