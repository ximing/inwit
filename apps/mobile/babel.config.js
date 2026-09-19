module.exports = function (api) {
  api.cache(true);
  return {
    // Absolute paths so Metro/Babel still find these under pnpm's .pnpm store
    // (release bundling starts from expo-router/entry.js, not apps/mobile).
    presets: [require.resolve('babel-preset-expo')],
    plugins: [require.resolve('react-native-reanimated/plugin')],
  };
};
