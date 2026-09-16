/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly VITE_TAURI_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
