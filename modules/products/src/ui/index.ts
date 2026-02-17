// modules/products/src/ui/index.ts
export { default } from './ModuleEntry.js';

// DEFAULT EXPORT — REQUIRED (runtime value)
export { default as ProductsModule } from './pages/ProductsPage.js';
export { default as ProductsModuleFT2 } from './pages/ProductsModuleFT2.js';

// hooks
export { useProductsFt1Scenario } from './hooks/useProductsFt1Scenario.js';

// components
export { ProductsDiagnosticCard } from './components/ProductsDiagnosticCard.js';

// types
export type { ProductsFt1Scenario } from './types.js';
export type { ProductsModuleProps } from './pages/ProductsPage.js';
export type { ProductsModuleFT2Props } from './pages/ProductsModuleFT2.js';
