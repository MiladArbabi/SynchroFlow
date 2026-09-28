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
    moduleId: 'wms',
    displayName: 'Warehouse Operations',
    requiredSignals: [
      'wms.zonesConfigured',
      'wms.barcodesPrinted',
      'wms.carrierConfigured',
      // GH-1156: exposed so reconcile-inventory's completion rule can
      // evaluate, and so the SETUP assembler knows whether opening inventory
      // applies at all. Exposure only: the task stays required: false and
      // FT1 gating is unchanged.
      'wms.openingInventoryReconciliationRequired',
      'wms.openingInventoryReconciled'
    ],
    tasks: [
      {
        id: 'map-zones',
        label: 'Map your warehouse zones',
        required: false,
        completionRules: [
          { signal: 'wms.zonesConfigured', expectedValue: true }
        ],
        // GH-1176: serialized straight into Setup > Canvas, where the
        // warehouse boundary is established first.
        action: { type: 'navigate', target: '/floor-planning?tab=setup&view=canvas' }
      },
      {
        id: 'print-barcodes',
        label: 'Print your first location barcode',
        required: false,
        completionRules: [
          { signal: 'wms.barcodesPrinted', expectedValue: true }
        ],
        action: { type: 'navigate', target: '/floor-planning' }
      },
      {
        id: 'connect-carrier',
        label: 'Connect your shipping carrier',
        required: false,
        completionRules: [
          { signal: 'wms.carrierConfigured', expectedValue: true }
        ],
        action: { type: 'navigate', target: '/settings/carriers' }
      },
      {
        id: 'reconcile-inventory',
        label: 'Reconcile inventory',
        required: false,
        completionRules: [
          {
            signal: 'wms.openingInventoryReconciled',
            expectedValue: true
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
    moduleId: 'finances',
    displayName: 'Finances',
    requiredSignals: [
      'finances.transactionCount',
      'finances.costDataReady',
      'finances.baseSignalsReady'
    ],
    tasks: [
      {
        id: 'finances.complete-cost-setup',
        label: 'Complete cost setup',
        required: false,
        completionRules: [
          {
            signal: 'finances.costDataReady',
            expectedValue: true
          }
        ]
      }
    ]
  }
];
