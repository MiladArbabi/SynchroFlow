// modules/finances/src/ui/index.ts
export { default as FinancesModule } from './pages/FinancesModule.js';
export { default as FinancesModuleFT2 } from './pages/FinancesModuleFT2.js';

export type { FinancesModuleProps } from './pages/FinancesModule.js';
export type { FinancesModuleFT2Props } from './pages/FinancesModuleFT2.js';

export * from './hooks/useFinancesFt1Scenario.js';
export type { FinancesUiIntent } from './intents.js';