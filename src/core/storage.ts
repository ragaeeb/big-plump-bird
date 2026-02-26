import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathExists } from './utils';

export interface StorageBackend {
    putFile(srcPath: string, destPath: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    remove(path: string): Promise<void>;
}

export class LocalStorageBackend implements StorageBackend {
    async putFile(srcPath: string, destPath: string): Promise<void> {
        await mkdir(dirname(destPath), { recursive: true });
        await cp(srcPath, destPath);
    }

    async exists(path: string): Promise<boolean> {
        return pathExists(path);
    }

    async remove(path: string): Promise<void> {
        await rm(path, { force: true });
    }
}
