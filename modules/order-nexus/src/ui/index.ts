export { default } from './ModuleEntry';

// named exports only (UI surface)
export { default as OrdersModule } from './pages/OrdersModule';
export { default as OrdersModuleFT2 } from './pages/OrdersModuleFT2';

export type { OrdersModuleProps } from './pages/OrdersModule';
export type {
  OrdersModuleFT2Props,
  OrdersModuleFT2DataProps,
} from './pages/OrdersModuleFT2';

export * from './hooks/useOrdersFt1Scenario';
export type { OrderNexusUiIntent } from './intents';
export { OrderNexusAhaPanel } from './OrderNexusAhaPanel';