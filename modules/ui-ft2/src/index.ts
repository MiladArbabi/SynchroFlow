export { FT2Layout } from './layout/FT2Layout.js';
export { FT2Row } from './layout/FT2Row.js';
export { FT2_TOKENS } from './layout/ft2.tokens.js';

export * from './panel/index.js';
export * from './layout/index.js';
export * from './contracts/index.js';
export * from './visuals/index.js';
export * from './primitives/index.js';

/**
 * COMPATIBILITY EXPORT — FT2Surface
 * ---------------------------------
 * Legacy modules still import FT2Surface.
 *
 * The panel architecture replaced FT2Surface
 * with FT2Panel. Until all modules are migrated,
 * we provide a temporary alias.
 *
 * Removal plan:
 * - migrate remaining modules
 * - remove this export
 */
export { FT2Panel as FT2Surface } from './panel/FT2Panel.js';

export { InfoBlockRow } from './primitives/InfoBlockRow.js';