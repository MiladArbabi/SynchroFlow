// packages/order-nexus/src/modules/module-presence.ts
export class ModulePresenceManager {
  constructor(private readonly moduleRegistry: ModuleRegistry) {}

  async getModulePresence(shopId: number): Promise<ModulePresence> {
    const [
      specter,
      finance,
      skuOs,
      wmsLite,
      echoHub,
      orderNexus,
      returnNexus,
      psCore
    ] = await Promise.all([
      this.moduleRegistry.isInstalled('specter', shopId),
      this.moduleRegistry.isInstalled('finance', shopId),
      this.moduleRegistry.isInstalled('sku-os', shopId),
      this.moduleRegistry.isInstalled('wms-lite', shopId),
      this.moduleRegistry.isInstalled('echo-hub', shopId),
      this.moduleRegistry.isInstalled('order-nexus', shopId),
      this.moduleRegistry.isInstalled('return-nexus', shopId),
      this.moduleRegistry.isInstalled('ps-core', shopId)
    ]);

    return {
      specter,
      finance,
      skuOs,
      wmsLite,
      echoHub,
      orderNexus,
      returnNexus,
      psCore
    };
  }

  getCapabilityFlags(presence: ModulePresence): CapabilityFlags {
    return {
      hasPreciseCostModels: presence.finance,
      hasCustomerBehaviorData: presence.specter,
      hasInventoryIntelligence: presence.skuOs,
      hasAutomatedFulfillment: presence.wmsLite,
      hasWorkflowAutomation: presence.echoHub,
      hasReturnsIntelligence: presence.returnNexus,
      hasQualityIntelligence: presence.returnNexus || presence.psCore
    };
  }
}