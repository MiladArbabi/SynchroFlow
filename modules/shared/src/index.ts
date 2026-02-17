// modules/shared/src/index.ts

// --- External contracts ONLY ---
export * from './contracts/canonical-commerce.js';
export * from './contracts/canonical-product.js';
export * from './contracts/onboarding.js';
export * from './contracts/free-tier.js';
export * from './contracts/returns-quality-contract.js';

// --- Runtime helpers ---
export * from './modules/module-presence.js';

// --- UI contracts ---
export * from './ui-contracts.js';

// --- Runtime module descriptor (UI loader contract) ---
export { default } from './ui/ModuleEntry.js';

// ⚠️ IMPORTANT
// Activation is intentionally NOT exported from root.
// Consumers MUST import from `@lasyncro/shared/activation`.
