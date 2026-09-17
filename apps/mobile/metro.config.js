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

// dto `types` points at src/index.ts. If Metro lands on that TS graph (or a
// sibling .js specifier inside packages/dto|doc-schema), rewrite to .ts so
// babel-preset-expo can transpile it.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const origin = context.originModulePath ?? '';
  const fromWorkspaceTs =
    origin.includes(`${path.sep}packages${path.sep}dto${path.sep}`) ||
    origin.includes(`${path.sep}packages${path.sep}doc-schema${path.sep}`);
  if (fromWorkspaceTs && moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    const originDir = path.dirname(origin);
    const tsCandidate = path.resolve(originDir, moduleName.replace(/\.js$/, '.ts'));
    if (fs.existsSync(tsCandidate)) {
      return { type: 'sourceFile', filePath: tsCandidate };
    }
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
