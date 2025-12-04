//apps/backend/src/services/opsIntel/rules.ts
import knex from '../../db'; // Import our Knex instance
import { BusinessRule } from './index';
import { ProactiveInsight } from './types';

/**
 * Finds the single most "stale" order (pending for > 24 hours).
 * We only return one at a time to avoid spamming the user.
 */
export const staleOrderRule: BusinessRule = {
  id: 'stale-orders',
  schedule: '*/5 * * * *', // Runs every 5 minutes
  execute: async (): Promise<ProactiveInsight | null> => {
    try {
      // Calculate 24 hours ago
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // Find the oldest order that is still 'pending'
      const staleOrder = await knex('orders')
        .where('fulfillment_status', 'pending')
        .where('created_at', '<', twentyFourHoursAgo)
        .orderBy('created_at', 'asc') // Get the oldest one first
        .first();

      // If no stale orders, we're done
      if (!staleOrder) {
        return null;
      }

      // We found one. Create the insight payload.
      const hoursStale = (Date.now() - new Date(staleOrder.created_at).getTime()) / (1000 * 60 * 60);

      const insight: ProactiveInsight = {
        id: `stale-order-${staleOrder.id}`,
        type: 'alert',
        title: 'Stale Order Detected',
        message: `Order #${staleOrder.id} has been 'pending' for ${Math.round(hoursStale)} hours.`,
        urgency: 'medium',
        timestamp: Date.now(),
        source: 'orders',
        actionPayload: [
          {
            actionId: 'nav-order-detail', // A frontend action ID
            context: { orderId: staleOrder.id }, // The data to send
          },
        ],
      };
      
      return insight;

    } catch (error: any) {
      console.error(`[OpsIntelEngine] Error executing rule ${staleOrderRule.id}: ${error.message}`);
      return null;
    }
  },
};

// We will add lowInventoryRule and refundAnomalyRule here later