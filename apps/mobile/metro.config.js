// apps/mobile/metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/**
 * MONOREPO METRO CONFIG
 * ----------------------
 * Configures Metro bundler to resolve workspace packages.
 *
 * watchFolders: tells Metro to watch the monorepo root
 * so @lasyncro/mobile-core and other packages are resolved.
 *
 * resolver.nodeModulesPaths: ensures node_modules at root
 * are found when resolving workspace dependencies.
 */

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the entire monorepo so workspace packages are picked up
config.watchFolders = [monorepoRoot];

// Resolve modules from both app and monorepo root node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

module.exports = config;