const { getDefaultConfig } = require('expo/metro-config');
const fs = require('fs');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Local doc-engine HTML is a Metro asset (require('../assets/doc-engine.html')).
const assetExts = config.resolver.assetExts ?? [];
const sourceExts = config.resolver.sourceExts ?? [];
config.resolver.assetExts = [...new Set([...assetExts.filter((ext) => ext !== 'html'), 'html'])];
config.resolver.sourceExts = sourceExts.filter((ext) => ext !== 'html');

// Monorepo: watch the repo root so workspace packages (@inwit/dto) invalidate.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// dto `types` points at src/index.ts. Relative imports keep the `.js` suffix
// (NodeNext). Metro does not map that suffix onto `.ts` / `.tsx`, so rewrite
// it for the mobile app and the workspace packages it bundles.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const origin = context.originModulePath ?? '';
  const fromTypedSource =
    origin.includes(`${path.sep}apps${path.sep}mobile${path.sep}`) ||
    origin.includes(`${path.sep}packages${path.sep}dto${path.sep}`) ||
    origin.includes(`${path.sep}packages${path.sep}doc-schema${path.sep}`);
  if (fromTypedSource && moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    const originDir = path.dirname(origin);
    const stem = moduleName.replace(/\.js$/, '');
    for (const ext of ['.ts', '.tsx']) {
      const candidate = path.resolve(originDir, `${stem}${ext}`);
      if (fs.existsSync(candidate)) {
        return { type: 'sourceFile', filePath: candidate };
      }
    }
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
