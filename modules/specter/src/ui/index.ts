// modules/specter/src/ui/index.ts
export { default as SpecterModule } from './pages/SpecterModule.js';
export { default as SpecterModuleFT2 } from './pages/SpecterModuleFT2.js';

// hooks
export { useSpecterFt1Scenario } from './hooks/useSpecterFt1Scenario.js';

// components
export { SpecterDiagnosticCard } from './components/SpecterDiagnosticCard.js';

// types
export type { SpecterFt1Scenario } from './types.js';
export type { SpecterUiIntent } from './intents.js';

//props
export type { SpecterModuleProps } from './pages/SpecterModule.js';