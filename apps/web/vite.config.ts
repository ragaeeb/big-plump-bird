import { readFileSync } from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

type RootPackageJson = {
    version?: string;
    homepage?: string;
    author?: string | { name?: string; url?: string };
};

const rootPackageJsonPath = path.resolve(__dirname, '../../package.json');
const rootPackageRaw = readFileSync(rootPackageJsonPath, 'utf-8');
const rootPackage = JSON.parse(rootPackageRaw) as RootPackageJson;

const appVersion = rootPackage.version ?? '0.0.0';
const homepage = rootPackage.homepage ?? '';
const repositoryUrl = normalizeRepositoryUrl(homepage);
const authorName = typeof rootPackage.author === 'string' ? rootPackage.author : (rootPackage.author?.name ?? '');
const authorUrl = typeof rootPackage.author === 'string' ? '' : (rootPackage.author?.url ?? '');

// https://vite.dev/config/
export default defineConfig({
    define: {
        'import.meta.env.VITE_BPB_AUTHOR_NAME': JSON.stringify(authorName),
        'import.meta.env.VITE_BPB_AUTHOR_URL': JSON.stringify(authorUrl),
        'import.meta.env.VITE_BPB_REPOSITORY_URL': JSON.stringify(repositoryUrl),
        'import.meta.env.VITE_BPB_VERSION': JSON.stringify(appVersion),
    },
    plugins: [tailwindcss(), react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    server: {
        host: true,
        proxy: {
            '/api': {
                changeOrigin: true,
                target: process.env.VITE_BPB_API_PROXY_TARGET ?? 'http://127.0.0.1:8787',
            },
        },
    },
});

function normalizeRepositoryUrl(homepageUrl: string): string {
    if (!homepageUrl) {
        return '';
    }
    try {
        const url = new URL(homepageUrl);
        url.hash = '';
        return url.toString().replace(/\/$/, '');
    } catch {
        return homepageUrl.replace(/#.*$/, '');
    }
}
