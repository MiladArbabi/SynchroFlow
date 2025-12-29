// modules/specter/src/ui/index.ts
export { default as SpecterModule } from './pages/SpecterModule';

// hooks
export { useSpecterFt1Scenario } from './hooks/useSpecterFt1Scenario';

// components
export { SpecterDiagnosticCard } from './components/SpecterDiagnosticCard';

// types
export type { SpecterFt1Scenario } from './types';
export type { SpecterUiIntent } from './intents';

//props
export type { SpecterModuleProps } from './pages/SpecterModule';