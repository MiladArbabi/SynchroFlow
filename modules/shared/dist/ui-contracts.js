/**
 * Shared UI contract types — authoritative.
 * Keep this file small and stable. Import these types from modules and host code.
 */
// 2026-06-24: re-exported here (not from the package root) so consumers use
// the proven `@lasyncro/shared/ui-contracts` subpath — mirrors CurrencyContext
// below. The bare `@lasyncro/shared` root import triggered a tsc composite-
// project rootDir/file-list conflict in modules/finances; this subpath does not.
export * from './contracts/finances-intelligence.js';
