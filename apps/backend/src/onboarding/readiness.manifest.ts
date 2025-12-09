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
      'user.ordersPerMonthSegment',
    ],
    tasks: [
      {
        id: 'connect-store',
        label: 'Connect your Shopify store',
        required: true,
        completionRules: [
          { signal: 'integration.connected', expectedValue: true },
        ],
        action: { type: 'openModal', target: 'connect-store' },
      },
      {
        id: 'complete-sync',
        label: 'Complete your first data sync',
        required: true,
        completionRules: [
          { signal: 'integration.syncCompleted', expectedValue: true },
        ],
      },
      {
        id: 'orders-per-month',
        label: 'Tell us your monthly order volume',
        required: true,
        completionRules: [
          {
            signal: 'user.ordersPerMonthSegment',
            operator: 'not_equals',
            expectedValue: null,
          },
        ],
      },
    ],
  },
  {
    moduleId: 'order-nexus',
    displayName: 'Orders & Profitability',
    requiredSignals: [
      'integration.syncCompleted',          // foundation dependency
      'orderNexus.profitabilityActive',     // business readiness flag
      'orderNexus.ordersIngested',          // quantitative metric
      'orderNexus.missingCostCount',        // data quality
      'orderNexus.hasNegativeMarginOrder',  // bleed detection
      'orderNexus.modeDetermined',          // configuration
      'order-nexus.freeTierState',          // FTEP
      'order-nexus.freeTierRemaining'       // FTEP
    ],
    tasks: [
      // 1) Review your first Profit Autopsy (hero moment)
      {
        id: 'orderNexus.reviewProfitAutopsy',
        label: 'Review your first Profit Autopsy',
        required: true,
        completionRules: [
          {
            signal: 'orderNexus.profitabilityActive',
            operator: 'equals',
            expectedValue: true
          }
        ],
        action: {
          type: 'navigate',
          target: '/orders' // or your dedicated Profit Autopsy route
        }
      },

      // 2) Fix missing costs so your profit is real
      {
        id: 'orderNexus.resolveMissingCosts',
        label: 'Fix missing costs so your profit is real',
        required: true,
        completionRules: [
          {
            signal: 'orderNexus.missingCostCount',
            operator: 'equals',
            expectedValue: 0
          }
        ],
        action: {
          type: 'navigate',
          target: '/products' // or a "Missing Costs" view when you have it
        }
      },

      // 3) Check your Bleed Feed (unprofitable orders)
      {
        id: 'orderNexus.checkBleedFeed',
        label: 'Check your Bleed Feed',
        required: false,
        completionRules: [
          {
            signal: 'orderNexus.hasNegativeMarginOrder',
            operator: 'equals',
            expectedValue: true
          }
        ],
        action: {
          type: 'navigate',
          target: '/orders/bleeders' // canonical Bleed Feed route
        }
      },

      // 4) Confirm your operating mode (Survival / Growth / Architect)
      {
        id: 'orderNexus.confirmMode',
        label: 'Confirm your operating mode',
        required: false, // important: not a hard readiness gate for FT0
        completionRules: [
          {
            signal: 'orderNexus.modeDetermined',
            operator: 'equals',
            expectedValue: true
          }
        ],
        action: {
          type: 'openModal', // or 'navigate' depending on how you wire mode settings
          target: 'orderNexus.mode'
        }
      }
    ],
  },
  // --- New: Products & Inventory (SKU-OS) ---
  {
    moduleId: 'sku-os',
    displayName: 'Product Health',
    requiredSignals: [
      'integration.syncCompleted',
      'skuOs.productHealthEvents',
      'sku-os.freeTierState',
      'sku-os.freeTierRemaining'
    ],
    tasks: [
      // REQUIRED — SKU-OS becomes meaningful once at least one health event exists
      {
        id: 'skuOs.firstProductHealthEvent',
        label: 'Receive your first product health event',
        required: true,
        completionRules: [
          {
            signal: 'skuOs.productHealthEvents',
            operator: 'gte',
            expectedValue: 1
          }
        ]
      },

      // OPTIONAL — Encourages merchants to explore SKU-OS insights
      {
        id: 'skuOs.reviewProductHealth',
        label: 'Review your product health insights',
        required: false,
        completionRules: [
          {
            signal: 'skuOs.productCount',
            operator: 'gte',
            expectedValue: 1
          }
        ],
        action: {
          type: 'navigate',
          target: '/products/health'
        }
      }
    ]
  }, {
    moduleId: 'specter',
    displayName: 'Customer & Conversion (Specter)',
    requiredSignals: [
      'specter.sdkInstalled',
      'specter.sessionVolume',
      'specter.intentFeedActive',
      'specter.exitIntentRate',
      'specter.topPageFunnelsDetected',
      'specter.customerSignalFallbackMode'
    ],
    tasks: [
      {
        id: 'specter-sdk-installed',
        label: 'Enable Specter tracking',
        required: false,
        completionRules: [
          { signal: 'specter.sdkInstalled', expectedValue: true }
        ],
        action: {
          type: 'openExternal',
          target: 'https://docs.lasyncro.com/specter/getting-started'
        }
      },
      {
        id: 'specter.reviewBehaviorSnapshot',
        label: 'Review your Behavior Snapshot',
        required: false,
        // Completed when we have at least 1 session OR basic funnels detected
        completionRules: [
          {
            signal: 'specter.sessionVolume',
            operator: 'gte',
            expectedValue: 1
          },
          {
            signal: 'specter.topPageFunnelsDetected',
            operator: 'equals',
            expectedValue: true
          }
        ],
        action: {
          type: 'navigate',
          target: '/insights/specter' // UI route to the Specter behavioral snapshot
        }
      }
    ]
  }, {
    moduleId: 'insight-core',
    displayName: 'Core CNS Intelligence (InsightCore)',
    requiredSignals: [
      'insightCore.orderCount',
      'insightCore.productCount',
      'insightCore.baseSignalsReady'
    ],
    tasks: [
      // Availability task: indicates when InsightCore has minimal data to generate FT0 insights.
      {
        id: 'insight-core-base-signals',
        label: 'Collect enough orders and products for meaningful insights',
        required: false, // availability only; does not block FT0 onboarding
        completionRules: [
          { signal: 'insightCore.baseSignalsReady', expectedValue: true }
        ]
      },

      // FT0 Aha exposure: surface the Top Driver widget once base signals exist.
      // This task is informational: considered satisfied when the base signals are ready.
      {
        id: 'insight-core-view-top-driver',
        label: 'View your Top Driver insight',
        required: false,
        completionRules: [
          { signal: 'insightCore.baseSignalsReady', expectedValue: true }
        ],
        action: {
          type: 'navigate',
          target: '/insights/top-driver'
        }
      },

      // Optional: encourage merchants to explore baseline dashboards.
      {
        id: 'insight-core-explore-baseline',
        label: 'Explore baseline business insights',
        required: false,
        completionRules: [
          { signal: 'insightCore.orderCount', operator: 'gte', expectedValue: 1 },
          { signal: 'insightCore.productCount', operator: 'gte', expectedValue: 1 }
        ],
        action: {
          type: 'navigate',
          target: '/insights/overview'
        }
      }
    ]
  }
];