import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';

export type CommandResult = {
    stdout: string;
    stderr: string;
    exitCode: number;
};

const STREAM_CAPTURE_LIMIT = 64 * 1024;

function appendTail(current: string, chunk: string, limit: number): string {
    if (chunk.length >= limit) {
        return chunk.slice(-limit);
    }
    const merged = current + chunk;
    if (merged.length <= limit) {
        return merged;
    }
    return merged.slice(merged.length - limit);
}

async function streamToProcessAndCapture(
    stream: ReadableStream<Uint8Array> | null,
    writeChunk: (chunk: string) => void,
): Promise<string> {
    if (!stream) {
        return '';
    }
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let captured = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        if (!value) {
            continue;
        }
        const chunk = decoder.decode(value, { stream: true });
        writeChunk(chunk);
        captured = appendTail(captured, chunk, STREAM_CAPTURE_LIMIT);
    }

    const finalChunk = decoder.decode();
    if (finalChunk.length > 0) {
        writeChunk(finalChunk);
        captured = appendTail(captured, finalChunk, STREAM_CAPTURE_LIMIT);
    }

    return captured;
}

export async function runCommand(
    cmd: string,
    args: string[],
    opts?: { cwd?: string; stream?: boolean; env?: Record<string, string | undefined> },
): Promise<CommandResult> {
    const env = opts?.env ? { ...process.env, ...opts.env } : process.env;

    if (opts?.stream) {
        const proc = Bun.spawn([cmd, ...args], {
            cwd: opts?.cwd,
            env,
            stderr: 'pipe',
            stdout: 'pipe',
        });
        const [stdout, stderr, exitCode] = await Promise.all([
            streamToProcessAndCapture(proc.stdout, (chunk) => process.stdout.write(chunk)),
            streamToProcessAndCapture(proc.stderr, (chunk) => process.stderr.write(chunk)),
            proc.exited,
        ]);
        return { exitCode, stderr, stdout };
    }

    const proc = Bun.spawn([cmd, ...args], {
        cwd: opts?.cwd,
        env,
        stderr: 'pipe',
        stdout: 'pipe',
    });
    const stdoutPromise = new Response(proc.stdout).text();
    const stderrPromise = new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    return { exitCode, stderr, stdout };
}

export async function ensureDir(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
}

export async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

export async function sha256File(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = createHash('sha256');
        const stream = createReadStream(filePath);
        stream.on('error', reject);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

export function sha256String(input: string): string {
    const hash = createHash('sha256');
    hash.update(input);
    return hash.digest('hex');
}

export function formatTimestamp(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
