/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** API origin for the socket; required in prod, where VITE_API_URL is relative. */
  readonly VITE_SOCKET_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
