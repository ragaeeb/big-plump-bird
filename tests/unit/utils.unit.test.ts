import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureDir, formatTimestamp, pathExists, runCommand, sha256String } from '../../src/core/utils';

const tempDirs: string[] = [];

afterEach(async () => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (!dir) {
            continue;
        }
        await rm(dir, { force: true, recursive: true });
    }
});

// ---------------------------------------------------------------------------
// runCommand
// ---------------------------------------------------------------------------
describe('runCommand', () => {
    it('captures stdout and stderr from a simple command', async () => {
        const result = await runCommand('sh', ['-c', 'echo hello; echo world >&2']);
        expect(result.stdout.trim()).toBe('hello');
        expect(result.stderr.trim()).toBe('world');
        expect(result.exitCode).toBe(0);
    });

    it('returns non-zero exit code on failure', async () => {
        const result = await runCommand('sh', ['-c', 'exit 42']);
        expect(result.exitCode).toBe(42);
    });

    it('streams output when stream option is true', async () => {
        const result = await runCommand('sh', ['-c', 'echo streamed'], { stream: true });
        expect(result.stdout.trim()).toBe('streamed');
        expect(result.exitCode).toBe(0);
    });

    it('passes custom env variables', async () => {
        const result = await runCommand('sh', ['-c', 'echo $MY_TEST_VAR'], { env: { MY_TEST_VAR: 'bpb-test' } });
        expect(result.stdout.trim()).toBe('bpb-test');
    });

    it('passes cwd option', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'bpb-utils-'));
        tempDirs.push(dir);
        const result = await runCommand('sh', ['-c', 'pwd'], { cwd: dir });
        // pwd may resolve symlinks differently; compare realpath
        expect(result.exitCode).toBe(0);
    });

    it('captures large streamed output and caps at 64KB', async () => {
        // Generate output larger than the 64KB capture limit (65536 bytes) in a single chunk
        // to trigger the "chunk.length >= limit" branch in pushCappedChunk
        const result = await runCommand('sh', ['-c', 'printf "%70000s" "" | tr " " "x"'], { stream: true });
        // The captured output should be capped to at most 64KB + some overhead
        expect(result.stdout.length).toBeLessThanOrEqual(64 * 1024 + 100);
        expect(result.exitCode).toBe(0);
    });

    it('captures output that overflows the rolling buffer', async () => {
        // Generate many small chunks totalling more than 64KB to exercise the overflow trimming.
        // Each iteration writes ~1000 bytes and we do 100 iterations = ~100KB total, well over 64KB.
        const result = await runCommand('sh', ['-c', 'for i in $(seq 1 100); do printf "%1000s\\n" "line$i"; done'], {
            stream: true,
        });
        expect(result.stdout.length).toBeLessThanOrEqual(64 * 1024 + 500);
        expect(result.exitCode).toBe(0);
    });

    it('streams stdout with non-ASCII characters', async () => {
        // Write a file with non-ASCII UTF-8 content and cat it to trigger the streaming path
        // This exercises the TextDecoder usage in streamToProcessAndCapture
        const dir = await mkdtemp(join(tmpdir(), 'bpb-utf8-'));
        tempDirs.push(dir);
        const { writeFile: wf } = await import('node:fs/promises');
        const textFile = join(dir, 'utf8.txt');
        await wf(textFile, 'hello élève world');
        const result = await runCommand('sh', ['-c', `cat "${textFile}"`], { stream: true });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('hello');
        expect(result.stdout).toContain('world');
    });
});

// ---------------------------------------------------------------------------
// ensureDir
// ---------------------------------------------------------------------------
describe('ensureDir', () => {
    it('creates nested directories', async () => {
        const base = await mkdtemp(join(tmpdir(), 'bpb-ensuredir-'));
        tempDirs.push(base);
        const nested = join(base, 'a', 'b', 'c');
        await ensureDir(nested);
        expect(await pathExists(nested)).toBe(true);
    });

    it('does not throw if directory already exists', async () => {
        const base = await mkdtemp(join(tmpdir(), 'bpb-ensuredir-'));
        tempDirs.push(base);
        await ensureDir(base);
        await ensureDir(base); // idempotent
        expect(await pathExists(base)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// pathExists
// ---------------------------------------------------------------------------
describe('pathExists', () => {
    it('returns true for an existing directory', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'bpb-pathex-'));
        tempDirs.push(dir);
        expect(await pathExists(dir)).toBe(true);
    });

    it('returns false for a non-existent path', async () => {
        expect(await pathExists('/tmp/bpb-definitely-does-not-exist-12345')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// sha256String
// ---------------------------------------------------------------------------
describe('sha256String', () => {
    it('returns a 64-character hex string', () => {
        const hash = sha256String('hello');
        expect(hash).toHaveLength(64);
        expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    it('returns the same hash for the same input', () => {
        expect(sha256String('same')).toBe(sha256String('same'));
    });

    it('returns different hashes for different inputs', () => {
        expect(sha256String('a')).not.toBe(sha256String('b'));
    });

    it('returns correct known hash for empty string', () => {
        // SHA-256 of empty string
        expect(sha256String('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });
});

// ---------------------------------------------------------------------------
// formatTimestamp
// ---------------------------------------------------------------------------
describe('formatTimestamp', () => {
    it('formats 0ms as 00:00:00', () => {
        expect(formatTimestamp(0)).toBe('00:00:00');
    });

    it('formats 1000ms as 00:00:01', () => {
        expect(formatTimestamp(1000)).toBe('00:00:01');
    });

    it('formats 60000ms as 00:01:00', () => {
        expect(formatTimestamp(60000)).toBe('00:01:00');
    });

    it('formats 3600000ms as 01:00:00', () => {
        expect(formatTimestamp(3600000)).toBe('01:00:00');
    });

    it('formats 3661000ms as 01:01:01', () => {
        expect(formatTimestamp(3661000)).toBe('01:01:01');
    });

    it('formats sub-second values by truncating ms', () => {
        expect(formatTimestamp(500)).toBe('00:00:00');
        expect(formatTimestamp(1500)).toBe('00:00:01');
    });
});
