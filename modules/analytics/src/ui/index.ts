/* modules/analytics/src/ui/index.ts */
export { default } from './ModuleEntry';

export { default as AnalyticsModule } from './pages/AnalyticsModule';
export { default as AnalyticsModuleFT2 } from './pages/AnalyticsModuleFT2';

export { useAnalyticsFt1Scenario } from './hooks/useAnalyticsFt1Scenario';
export { AnalyticsDiagnosticCard } from './components/AnalyticsDiagnosticCard';
export type { AnalyticsFt1Scenario } from './types';
export type { AnalyticsModuleProps } from './pages/AnalyticsModule';
export type { AnalyticsUiIntent } from './intents';