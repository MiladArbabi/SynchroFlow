/**
 * Customers module public API
 * ---------------------------
 *
 * FT2 page is not exported from the module root.
 * It is loaded dynamically by the module system.
 *
 * This prevents runtime resolution failures
 * when TypeScript emits only type declarations.
 */
export * from './ui/index.js';
export { default } from './ui/index.js';
