// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
// Shared pure-TS package, consumed as source (no build).
const coreRoot = path.resolve(projectRoot, '../../packages/blissful-core');

const config = getDefaultConfig(projectRoot);

// Watch the shared core so Metro bundles + Fast-Refreshes its source.
config.watchFolders = [coreRoot];

// Resolve `@blissful/core(/sub)` to the core src; keep node_modules from the app.
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  '@blissful/core': path.resolve(coreRoot, 'src'),
};
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

module.exports = config;
