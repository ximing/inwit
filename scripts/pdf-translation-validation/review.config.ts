// Pure adapter review only: deliberately excludes server's DB globalSetup.
export default { test: { include: ['apps/server/src/llm/translation-call.test.ts', 'apps/server/src/llm/translation-sdk.test.ts', 'apps/server/src/admin/aggregates.test.ts', 'apps/server/src/jobs/job-view.test.ts'], environment: 'node' } };
