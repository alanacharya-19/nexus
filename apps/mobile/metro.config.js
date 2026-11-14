const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// npm workspaces hoist dependencies to the repository root. Metro needs to
// watch the whole workspace so the shared package and root modules resolve.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Keep hierarchical lookup enabled so nested dependencies (for example the
// `semver` copy bundled inside react-native-reanimated) resolve correctly in
// the npm workspace layout.

// expo-sqlite ships its web database engine as a .wasm asset.
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

module.exports = config;
