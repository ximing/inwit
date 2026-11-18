// Explicitly isolated: never import apps/server/vitest.config.ts (it has DB globalSetup).
export default { test: { include: ['apps/server/src/documents/translation/paragraph-logic.test.ts'], environment: 'node' } };
