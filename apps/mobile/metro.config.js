const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];

/**
 * MONOREPO RESOLUTION ORDER (CRITICAL)
 * -------------------------------------
 * List app node_modules FIRST so React resolves to 19.1.0
 * before falling back to monorepo root (19.2.4).
 * This prevents duplicate React hook errors.
 */
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

config.resolver.extraNodeModules = {
  '@lasyncro/mobile-core': path.resolve(monorepoRoot, 'packages/mobile-core/src'),
};

module.exports = config;