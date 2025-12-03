# Entitlements Flow Diagram – Backend → Frontend → UI

This diagram shows the **complete flow** of entitlements through LaSyncro.

              ┌─────────────────────────────┐
              │   Shopify OAuth Callback    │
              │  handleOAuthCallback(shop)  │
              └───────────────┬────────────┘
                              │
                       Grants FT0 bundle:
                              │
 ┌─────────────────────────── ▼──────────────────────────┐
 │ EntitlementsService.grantDefaultFreeTierForShop()    │
 │ Inserts module_id / flag_id rows into                │
 │ shop_module_entitlements                             │
 └───────────────────────────┬──────────────────────────┘
                             │
                             ▼
               ┌───────────────────────────────────────┐
               │ GET /api/v1/entitlements/me           │
               │ returns { shopId, modules, flags }    |
               └───────────────┬───────────────────────┘
                               │
                               ▼
           ┌──────────────────────────────────────────┐
           │      EntitlementsProvider (frontend)      │
           │ loads modules[] + flags[] into React ctx  │
           │ exposes: hasModule(), hasFlag(), refresh  │
           └─────────────────────┬─────────────────────┘
                                 │
                                 ▼
         ┌──────────────────────────────────────────────┐
         │        useWidgetRegistry (frontend)           │
         │ 1. Mode gating                                │
         │ 2. Plan gating (requiresPaidPlan)             │
         │ 3. Entitlement gating (requiredModuleId/Flag) │
         │ returns allowed widget list                   │
         └──────────────────────┬────────────────────────┘
                                │
                                ▼
                         Dashboard UI
       ┌─────────────────────────────────────────────────┐
       │ Widgets only render if entitlements allow them  │
       │ e.g., AdvancedAnalyticsWidget requires module   │
       │ "advanced-analytics"                            │
       └─────────────────────────────────────────────────┘