// apps/backend/src/onboarding/readiness.providers.ts
import db from '../db';
import {
  ReadinessSignal,
  ModuleId,
} from '@lasyncro/shared';
import { UserStateService } from '../services/user-state.service';

/**
 * Each module has a provider that outputs readiness signals.
 * Providers DO NOT evaluate tasks — they only produce signals.
 */

export interface OnboardingSignalProvider {
  moduleId: ModuleId;
  getSignals(ctx: { shopId: number; userId?: number }): Promise<ReadinessSignal[]>;
}

// --- Platform (FT0) provider: integration + sync + segmentation ---
export const platformOnboardingSignalProvider: OnboardingSignalProvider = {
  moduleId: 'platform',

  async getSignals(ctx: { shopId: number; userId?: number }): Promise<ReadinessSignal[]> {
    const { shopId, userId } = ctx;

    // 1) Integration presence & sync status (from integrations table)
    const integration = await db('integrations')
      .where({ shop_id: shopId })
      .first();

    const integrationConnected = !!integration;
    const integrationSyncCompleted = integration?.sync_status === 'COMPLETED';

    let ordersPerMonthSegment: string | null = null;
    if (userId) {
      const segment = await UserStateService.getOrdersPerMonthSegment(userId);
      ordersPerMonthSegment = segment ?? null;
    }

    return [
      {
        name: 'integration.connected',
        value: integrationConnected,
      },
      {
        name: 'integration.syncCompleted',
        value: integrationSyncCompleted,
      },
      {
        name: 'user.ordersPerMonthSegment',
        value: ordersPerMonthSegment,
      },
    ];
  },
};

// --- OrderNexus provider: orders & profitability readiness ---
export const orderNexusOnboardingSignalProvider: OnboardingSignalProvider = {
  moduleId: 'order-nexus',

    async getSignals({ shopId, userId }: { shopId: number; userId?: number }): Promise<ReadinessSignal[]> {

    // Count canonical orders for this shop.
    // NOTE: adjust table/column names if your canonical orders table differs.
    const row = await db('canonical_orders')
      .where({ shop_id: shopId })
      .count<{ count: string }>('id as count')
      .first();

    const ordersIngested = Number(row?.count ?? 0);

    // Look up explicit preferred mode from users.preferred_mode (if we have a userId)
    let modeSelected: string | null = null;
    if (userId) {
      const userRow = await db('users')
        .where({ id: userId })
        .first();
      modeSelected = userRow?.preferred_mode ?? null;
    }

    return [
      {
        name: 'orderNexus.profitabilityActive',
        value: ordersIngested > 0,
      },
      {
        name: 'orderNexus.ordersIngested',
        value: ordersIngested,
      },
      {
        name: 'user.modeSelected',
        value: modeSelected,
      },
    ];
  },
};

// Register providers
export const onboardingSignalProviders: OnboardingSignalProvider[] = [
  platformOnboardingSignalProvider,
  orderNexusOnboardingSignalProvider,
];
