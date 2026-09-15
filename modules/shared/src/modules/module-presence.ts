// packages/shared/src/modules/module-presence.ts
export interface ModulePresence {
  finance: boolean;
  skuOs: boolean;
  wmsLite: boolean;
  orderNexus: boolean;
  returnNexus: boolean;
  psCore: boolean;
}

export interface CapabilityFlags {
  hasPreciseCostModels: boolean;
  hasCustomerBehaviorData: boolean;
  hasInventoryIntelligence: boolean;
  hasAutomatedFulfillment: boolean;
  hasWorkflowAutomation: boolean;
  hasReturnsIntelligence: boolean;
  hasQualityIntelligence: boolean;
}
