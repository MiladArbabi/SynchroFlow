// modules/shared/src/index.ts

// --- External contracts ONLY ---
export * from './contracts/canonical-commerce';
export * from './contracts/canonical-product';
export * from './contracts/onboarding';
export * from './contracts/free-tier';
export * from './contracts/returns-quality-contract';

// --- Runtime helpers ---
export * from './modules/module-presence';

// --- UI contracts ---
export * from './ui-contracts';

// ⚠️ IMPORTANT
// Activation is intentionally NOT exported from root.
// Consumers MUST import from `@lasyncro/shared/activation`.
