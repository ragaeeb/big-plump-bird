import { createHash } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';

export type CommandResult = {
    stdout: string;
    stderr: string;
    exitCode: number;
};

const STREAM_CAPTURE_LIMIT = 64 * 1024;

function pushCappedChunk(chunks: string[], chunk: string, currentLength: number, limit: number): number {
    if (chunk.length >= limit) {
        chunks.length = 0;
        chunks.push(chunk.slice(-limit));
        return limit;
    }

    chunks.push(chunk);
    let nextLength = currentLength + chunk.length;

    while (nextLength > limit && chunks.length > 0) {
        const overflow = nextLength - limit;
        const first = chunks[0];
        if (first.length <= overflow) {
            chunks.shift();
            nextLength -= first.length;
            continue;
        }

        chunks[0] = first.slice(overflow);
        nextLength -= overflow;
    }

    return nextLength;
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
    const capturedChunks: string[] = [];
    let capturedLength = 0;

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
        capturedLength = pushCappedChunk(capturedChunks, chunk, capturedLength, STREAM_CAPTURE_LIMIT);
    }

    const finalChunk = decoder.decode();
    if (finalChunk.length > 0) {
        writeChunk(finalChunk);
        capturedLength = pushCappedChunk(capturedChunks, finalChunk, capturedLength, STREAM_CAPTURE_LIMIT);
    }

    return capturedChunks.join('');
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
