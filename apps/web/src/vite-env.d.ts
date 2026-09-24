/// <reference types="vite/client" />

/** Replaced at build time from `apps/web/package.json` `version`. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
