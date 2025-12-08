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
    displayName: 'Products & Inventory',
    requiredSignals: [
      'integration.syncCompleted',
      'skuOs.productCount',
      'skuOs.inventoryInsightsReady',
    ],
    tasks: [
      {
        id: 'review-products',
        label: 'Review your synced product catalog',
        required: true,
        completionRules: [
          {
            signal: 'skuOs.productCount',
            operator: 'gte',
            expectedValue: 1,
          },
        ],
      },
      {
        id: 'unlock-inventory-intelligence',
        label: 'Unlock inventory health insights',
        required: true,
        completionRules: [
          {
            signal: 'skuOs.inventoryInsightsReady',
            expectedValue: true,
          },
        ],
      },
    ],
  },  {
    moduleId: 'specter',
    displayName: 'Customer & Conversion (Specter)',
    requiredSignals: [
      'specter.sdkInstalled'
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
      }
    ]
  },
  {
    moduleId: 'insight-core',
    displayName: 'Core CNS Intelligence',
    requiredSignals: [
      'insightCore.orderCount',
      'insightCore.productCount',
      'insightCore.baseSignalsReady'
    ],
    tasks: [
      {
        id: 'insight-core-base-signals',
        label: 'Collect enough orders and products for meaningful insights',
        required: false,
        completionRules: [
          { signal: 'insightCore.baseSignalsReady', expectedValue: true }
        ]
      }
    ]
  }
];