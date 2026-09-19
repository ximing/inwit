const appJson = require('./app.json');

function resolveApiBaseUrl() {
  const candidates = [
    process.env.EXPO_PUBLIC_API_BASE_URL,
    process.env.INWIT_API_URL,
    process.env.VITE_TAURI_API_URL,
    appJson.expo?.extra?.apiBaseUrl,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim().replace(/\/$/, '');
    }
  }
  return 'http://localhost:3020';
}

module.exports = {
  ...appJson.expo,
  extra: {
    ...appJson.expo.extra,
    apiBaseUrl: resolveApiBaseUrl(),
  },
};
