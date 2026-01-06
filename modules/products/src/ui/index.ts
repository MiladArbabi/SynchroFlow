// modules/products/src/ui/index.ts
export { default } from './ModuleEntry';

// DEFAULT EXPORT — REQUIRED (runtime value)
export { default as ProductsModule } from './pages/ProductsPage';
export { default as ProductsModuleFT2 } from './pages/ProductsModuleFT2';

// hooks
export { useProductsFt1Scenario } from './hooks/useProductsFt1Scenario';

// components
export { ProductsDiagnosticCard } from './components/ProductsDiagnosticCard';

// types
export type { ProductsFt1Scenario } from './types';
export type { ProductsModuleProps } from './pages/ProductsPage';
export type { ProductsModuleFT2Props } from './pages/ProductsModuleFT2';
