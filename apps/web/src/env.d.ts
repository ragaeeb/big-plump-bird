/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_BPB_VERSION: string;
    readonly VITE_BPB_REPOSITORY_URL: string;
    readonly VITE_BPB_AUTHOR_NAME: string;
    readonly VITE_BPB_AUTHOR_URL: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
