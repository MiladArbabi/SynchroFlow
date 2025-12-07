//apps/backend/src/onboarding/readiness.manifest.ts
import { ModuleOnboardingReadiness } from '@lasyncro/shared';

export const MODULE_ONBOARDING_MANIFESTS: Array<
  Omit<ModuleOnboardingReadiness, 'isReady' | 'signals'>
> = [
  {
    moduleId: 'platform',
    displayName: 'Store Connection',
    requiredSignals: [
      'integration.connected',
      'integration.syncCompleted',
      'user.ordersPerMonthSegment'
    ],
    tasks: [
      {
        id: 'connect-store',
        label: 'Connect your Shopify store',
        required: true,
        completionRules: [
          { signal: 'integration.connected', expectedValue: true }
        ],
        action: { type: 'openModal', target: 'connect-store' }
      },
      {
        id: 'complete-sync',
        label: 'Complete your first data sync',
        required: true,
        completionRules: [
          { signal: 'integration.syncCompleted', expectedValue: true }
        ]
      },
      {
        id: 'orders-per-month',
        label: 'Tell us your monthly order volume',
        required: true,
        completionRules: [
          {
            signal: 'user.ordersPerMonthSegment',
            operator: 'not_equals',
            expectedValue: null
          }
        ]
      }
    ]
  }, {
    moduleId: 'order-nexus',
    displayName: 'Orders & Profitability',
    requiredSignals: [
      'integration.syncCompleted',
      'orderNexus.profitabilityActive',
      'orderNexus.ordersIngested'
    ],
    tasks: [
      {
        id: 'profitability-engine',
        label: 'Profitability Engine Activated',
        required: true,
        completionRules: [
          {
            signal: 'orderNexus.profitabilityActive',
            expectedValue: true
          }
        ]
      },
      {
        id: 'ingest-first-orders',
        label: 'Ingest first 5 orders',
        required: true,
        completionRules: [
          {
            signal: 'orderNexus.ordersIngested',
            operator: 'gte',
            expectedValue: 5
          }
        ]
      },
    ]
  }
];
