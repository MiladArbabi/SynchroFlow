// apps/backend/src/services/lifecycle.service.ts
import db from '../db';
import { OnboardingReadinessService } from '../onboarding/readiness.service';
import { EntitlementsService } from './entitlements.service';
import { resolveLifecyclePhase } from './lifecycle.resolver';
import type { LifecyclePhase } from './lifecycle.contract';

export type UserLifecyclePhase =
  | 'FT_MINUS_ONE'
  | 'FT0'
  | 'FT1'
  | 'FT2';

export class LifecycleService {
  static async resolveForUser(userId: number): Promise<LifecyclePhase>{
    // 1. Resolve user + shop
    const user = await db('users').where({ id: userId }).first();

    const hasShop = !!user?.shop_id;
    if (!hasShop) {
      return 'FT_MINUS_ONE';
    }

    const shopId = user.shop_id as number;

    // 2. Integrations
    const integrations = await db('integrations')
      .where({ shop_id: shopId })
      .select('id');

    const hasIntegration = integrations.length > 0;

    // 3. FT0 completion (authoritative latch)
    const ft0Row = await db('ft0_state')
      .where({ shop_id: shopId })
      .first();

    const ft0Completed = !!ft0Row;

    // 4. FT1 readiness
    let ft1Complete = false;
    if (ft0Completed) {
      const readinessService = new OnboardingReadinessService();
      const snapshot = await readinessService.getSnapshot({ shopId });
      ft1Complete = snapshot.ft1.isComplete;
    }

    // 5. Entitlements
    const entitlements = await EntitlementsService.getForUser(userId);
    const hasPaidEntitlements =
      !!entitlements &&
      (entitlements.flags.includes('paid') ||
        entitlements.flags.includes('premium'));

    // 6. Canonical lifecycle decision
    const phase = resolveLifecyclePhase({
      hasShop,
      hasIntegration,
      ft0Completed,
      ft1Complete,
      hasPaidEntitlements,
    });

    return phase;
  }
}