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
      'integration.syncCompleted'
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

      // ⬇️ MOVED OUT OF FT1 GATING
      {
        id: 'orders-per-month',
        label: 'Tell us your monthly order volume',
        required: false,
        completionRules: [
          {
            signal: 'user.ordersPerMonthSegment',
            operator: 'not_equals',
            expectedValue: null
          }
        ]
      }
    ]
  },

    {
    moduleId: 'order-nexus',
      displayName: 'Orders & Profitability',
      requiredSignals: [
        'integration.syncCompleted',
         'orderNexus.ordersKnown',
         'orderNexus.ordersIngested',
         'orderNexus.missingCostCount',
         'orderNexus.hasNegativeMarginOrder'
      ],
      tasks: [
        {
          id: 'orderNexus.reviewProfitAutopsy',
          label: 'Review your first Profit Autopsy',
          required: false,
          completionRules: [
            {
              signal: 'orderNexus.profitabilityActive',
              operator: 'equals',
              expectedValue: true
            }
          ],
          action: { type: 'navigate', target: '/orders' }
        },
        {
          id: 'orderNexus.resolveMissingCosts',
          label: 'Fix missing costs so your profit is real',
          required: false,
          completionRules: [
            {
              signal: 'orderNexus.missingCostCount',
              operator: 'equals',
              expectedValue: 0
            }
          ],
          action: { type: 'navigate', target: '/products' }
        }
      ]
    },

    {
    moduleId: 'sku-os',
    displayName: 'Product Health',
    requiredSignals: [],
    tasks: [
      {
        id: 'sku-os.firstProductHealthEvent',
        label: 'Receive your first product health event',
        required: false,
        completionRules: [
          {
            signal: 'sku-os.productHealthEvents',
            operator: 'gte',
            expectedValue: 1
          }
        ]
      }
    ]
  },

  {
  moduleId: 'specter',
    displayName: 'Customer & Conversion (Specter)',
    requiredSignals: [],
    tasks: [
      {
        id: 'specter-sdk-installed',
        label: 'Enable Specter tracking',
        required: false,
        completionRules: [
          { signal: 'specter.sdkInstalled', expectedValue: true }
        ]
      }
    ]
  },
  
  {
  moduleId: 'insight-core',
    displayName: 'Core CNS Intelligence',
    requiredSignals: [],
    tasks: [
      {
        id: 'insight-core-base-signals',
        label: 'Collect enough data for insights',
        required: false,
        completionRules: [
          { signal: 'insightCore.baseSignalsReady', expectedValue: true }
        ]
      }
    ]
  }
];