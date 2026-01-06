// modules/finances/src/ui/index.ts
export { default } from './ModuleEntry';
/* modules/finances/src/ui/index.ts */
export { default as FinancesModule } from './pages/FinancesModule';
export { default as FinancesModuleFT2 } from './pages/FinancesModuleFT2';

export type { FinancesModuleProps } from './pages/FinancesModule'
export type { FinancesModuleFT2Props } from './pages/FinancesModuleFT2'

export * from './hooks/useFinancesFt1Scenario';
export type { FinancesUiIntent } from './intents';

export type { FinancesFt1Scenario } from './hooks/useFinancesFt1Scenario';