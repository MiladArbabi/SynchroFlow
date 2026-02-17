export { default } from './ModuleEntry.js';

// named exports only (UI surface)
export { default as OrdersModule } from './pages/OrdersModule.js';
export { default as OrdersModuleFT2 } from './pages/OrdersModuleFT2.js';

export type { OrdersModuleProps } from './pages/OrdersModule.js';
export type {
  OrdersModuleFT2Props,
  OrdersModuleFT2DataProps,
} from './pages/OrdersModuleFT2.js';

export * from './hooks/useOrdersFt1Scenario.js';
export type { OrderNexusUiIntent } from './intents.js';
export { OrderNexusAhaPanel } from './OrderNexusAhaPanel.js';