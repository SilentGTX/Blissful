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
// NOTE: `extraNodeModules` is honoured by the Metro DEV server but NOT by the
// release bundle (`expo export:embed`), and Expo overwrites a `resolveRequest`
// hook internally — so a RELEASE build (`gradlew assembleRelease`) needs the
// junction `node_modules/@blissful/core -> ../../packages/blissful-core`, which
// `npm run link:core` recreates (also created by `postinstall`). See package.json.
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  '@blissful/core': path.resolve(coreRoot, 'src'),
};
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

module.exports = config;
