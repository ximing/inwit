export default {
  resolve: {
    alias: {
      vitest: new URL(
        "../../apps/server/node_modules/vitest/dist/index.js",
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    include: ["scripts/pdf-translation-streaming-validation/*.test.ts"],
    testTimeout: 120000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
};
