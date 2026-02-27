import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as utils from '../../src/core/utils';
import { downloadAudio, expandYtDlpUrls, getYtDlpId, resetAria2cCheck } from '../../src/core/yt_dlp';

const tempDirs: string[] = [];

afterEach(async () => {
    resetAria2cCheck();
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (!dir) {
            continue;
        }
        await rm(dir, { force: true, recursive: true });
    }
});

async function makeTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'bpb-ytdlp-test-'));
    tempDirs.push(dir);
    return dir;
}

// ---------------------------------------------------------------------------
// getYtDlpId
// ---------------------------------------------------------------------------
describe('getYtDlpId', () => {
    it('returns the video id from stdout', async () => {
        const spy = spyOn(utils, 'runCommand').mockResolvedValue({ exitCode: 0, stderr: '', stdout: 'dQw4w9WgXcQ\n' });
        const id = await getYtDlpId('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        expect(id).toBe('dQw4w9WgXcQ');
        spy.mockRestore();
    });

    it('returns the last line when stdout contains multiple lines', async () => {
        const spy = spyOn(utils, 'runCommand').mockResolvedValue({
            exitCode: 0,
            stderr: '',
            stdout: 'WARNING: ignoring something\ndQw4w9WgXcQ\n',
        });
        const id = await getYtDlpId('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        expect(id).toBe('dQw4w9WgXcQ');
        spy.mockRestore();
    });

    it('throws when exit code is non-zero', async () => {
        const spy = spyOn(utils, 'runCommand').mockResolvedValue({ exitCode: 1, stderr: 'error', stdout: '' });
        await expect(getYtDlpId('https://bad-url')).rejects.toThrow('yt-dlp failed to get id');
        spy.mockRestore();
    });

    it('throws when stdout is empty', async () => {
        const spy = spyOn(utils, 'runCommand').mockResolvedValue({ exitCode: 0, stderr: '', stdout: '  \n  \n' });
        await expect(getYtDlpId('https://empty')).rejects.toThrow('yt-dlp returned empty id');
        spy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// expandYtDlpUrls
// ---------------------------------------------------------------------------
describe('expandYtDlpUrls', () => {
    it('returns expanded URLs from stdout', async () => {
        const spy = spyOn(utils, 'runCommand').mockResolvedValue({
            exitCode: 0,
            stderr: '',
            stdout: 'https://www.youtube.com/watch?v=AAA\nhttps://www.youtube.com/watch?v=BBB\n',
        });
        const urls = await expandYtDlpUrls('https://www.youtube.com/playlist?list=PL123');
        expect(urls).toEqual(['https://www.youtube.com/watch?v=AAA', 'https://www.youtube.com/watch?v=BBB']);
        spy.mockRestore();
    });

    it('deduplicates urls', async () => {
        const spy = spyOn(utils, 'runCommand').mockResolvedValue({
            exitCode: 0,
            stderr: '',
            stdout: 'https://www.youtube.com/watch?v=AAA\nhttps://www.youtube.com/watch?v=AAA\n',
        });
        const urls = await expandYtDlpUrls('https://www.youtube.com/playlist?list=PL123');
        expect(urls).toEqual(['https://www.youtube.com/watch?v=AAA']);
        spy.mockRestore();
    });

    it('returns original URL when stdout has no valid URLs', async () => {
        const spy = spyOn(utils, 'runCommand').mockResolvedValue({ exitCode: 0, stderr: '', stdout: 'no urls here\n' });
        const original = 'https://www.youtube.com/watch?v=single';
        const urls = await expandYtDlpUrls(original);
        expect(urls).toEqual([original]);
        spy.mockRestore();
    });

    it('throws when yt-dlp exits non-zero', async () => {
        const spy = spyOn(utils, 'runCommand').mockResolvedValue({ exitCode: 1, stderr: '', stdout: '' });
        await expect(expandYtDlpUrls('https://bad')).rejects.toThrow('yt-dlp failed to expand URL list');
        spy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// downloadAudio
// ---------------------------------------------------------------------------
describe('downloadAudio', () => {
    it('throws when all download attempts fail', async () => {
        const spy = spyOn(utils, 'runCommand').mockResolvedValue({ exitCode: 1, stderr: '', stdout: '' });
        const dir = await makeTempDir();
        await expect(
            downloadAudio('https://example.com/video', {
                downloadVideo: false,
                format: 'bestaudio',
                id: 'vid-abc',
                outputDir: dir,
            }),
        ).rejects.toThrow('yt-dlp download failed after');
        spy.mockRestore();
    });

    it('throws when user interrupts the download', async () => {
        const spy = spyOn(utils, 'runCommand').mockResolvedValue({
            exitCode: 1,
            stderr: 'interrupted by user',
            stdout: '',
        });
        const dir = await makeTempDir();
        await expect(
            downloadAudio('https://example.com/video', {
                downloadVideo: false,
                format: 'bestaudio',
                id: 'vid-interrupt',
                outputDir: dir,
            }),
        ).rejects.toThrow('interrupted by user');
        spy.mockRestore();
    });

    it('throws when user sends KeyboardInterrupt', async () => {
        const spy = spyOn(utils, 'runCommand').mockResolvedValue({
            exitCode: 1,
            stderr: '',
            stdout: 'KeyboardInterrupt',
        });
        const dir = await makeTempDir();
        await expect(
            downloadAudio('https://example.com/video', {
                downloadVideo: false,
                format: 'bestaudio',
                id: 'vid-keyboard',
                outputDir: dir,
            }),
        ).rejects.toThrow('interrupted by user');
        spy.mockRestore();
    });

    it('succeeds and reads info.json when yt-dlp exits 0', async () => {
        const dir = await makeTempDir();
        const infoJson = JSON.stringify({ duration: 60, ext: 'webm', id: 'vid-ok', title: 'Test' });
        const mediaPath = join(dir, 'vid-ok.webm');

        // Create fake media file with sufficient size
        await writeFile(join(dir, 'vid-ok.info.json'), infoJson);
        await writeFile(mediaPath, Buffer.alloc(1000));

        const spy = spyOn(utils, 'runCommand').mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });

        const result = await downloadAudio('https://example.com/video', {
            downloadVideo: false,
            format: 'bestaudio',
            id: 'vid-ok',
            outputDir: dir,
        });

        expect(result.info.id).toBe('vid-ok');
        expect(result.filePath).toBe(mediaPath);
        expect(result.infoJsonPath).toBe(join(dir, 'vid-ok.info.json'));

        spy.mockRestore();
    });

    it('defaults to webm extension when ext is missing from info', async () => {
        const dir = await makeTempDir();
        const infoJson = JSON.stringify({ id: 'vid-noext', title: 'Test' }); // no ext field
        const mediaPath = join(dir, 'vid-noext.webm');

        await writeFile(join(dir, 'vid-noext.info.json'), infoJson);
        await writeFile(mediaPath, Buffer.alloc(1000));

        const spy = spyOn(utils, 'runCommand').mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });

        const result = await downloadAudio('https://example.com/video', {
            downloadVideo: false,
            format: 'bestaudio',
            id: 'vid-noext',
            outputDir: dir,
        });

        expect(result.filePath).toContain('.webm');

        spy.mockRestore();
    });

    it('throws when info.json is missing id field', async () => {
        const dir = await makeTempDir();
        const infoJson = JSON.stringify({ ext: 'webm', title: 'Test' }); // no id
        await writeFile(join(dir, 'vid-noid.info.json'), infoJson);

        const spy = spyOn(utils, 'runCommand').mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });

        await expect(
            downloadAudio('https://example.com/video', {
                downloadVideo: false,
                format: 'bestaudio',
                id: 'vid-noid',
                outputDir: dir,
            }),
        ).rejects.toThrow('missing id');

        spy.mockRestore();
    });

    it('throws when output file does not exist after download', async () => {
        const dir = await makeTempDir();
        // filesize in info will trigger file size check but file doesn't exist
        const infoJson = JSON.stringify({ ext: 'webm', filesize: 5000, id: 'vid-nofile' });
        await writeFile(join(dir, 'vid-nofile.info.json'), infoJson);
        // No media file created

        const spy = spyOn(utils, 'runCommand').mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });

        await expect(
            downloadAudio('https://example.com/video', {
                downloadVideo: false,
                format: 'bestaudio',
                id: 'vid-nofile',
                outputDir: dir,
            }),
        ).rejects.toThrow('did not produce output file');

        spy.mockRestore();
    });

    it('throws when file size is below 95% of expected', async () => {
        const dir = await makeTempDir();
        const expectedBytes = 10000;
        const infoJson = JSON.stringify({ ext: 'webm', filesize: expectedBytes, id: 'vid-small' });
        await writeFile(join(dir, 'vid-small.info.json'), infoJson);
        // Write a file much smaller than expected
        await writeFile(join(dir, 'vid-small.webm'), Buffer.alloc(100));

        const spy = spyOn(utils, 'runCommand').mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });

        await expect(
            downloadAudio('https://example.com/video', {
                downloadVideo: false,
                format: 'bestaudio',
                id: 'vid-small',
                outputDir: dir,
            }),
        ).rejects.toThrow('download appears incomplete');

        spy.mockRestore();
    });

    it('throws when duration is below 95% of expected', async () => {
        const dir = await makeTempDir();
        const infoJson = JSON.stringify({ duration: 60, ext: 'webm', id: 'vid-short' }); // expect 60s
        await writeFile(join(dir, 'vid-short.info.json'), infoJson);
        await writeFile(join(dir, 'vid-short.webm'), Buffer.alloc(1000));

        let callCount = 0;
        const spy = spyOn(utils, 'runCommand').mockImplementation(async (_cmd, _args) => {
            callCount++;
            // First download call succeeds, then ffprobe returns short duration
            if (_cmd === 'ffprobe') {
                return { exitCode: 0, stderr: '', stdout: '30.0\n' }; // only 30s, expected 60s
            }
            return { exitCode: 0, stderr: '', stdout: '' };
        });

        await expect(
            downloadAudio('https://example.com/video', {
                downloadVideo: false,
                format: 'bestaudio',
                id: 'vid-short',
                outputDir: dir,
            }),
        ).rejects.toThrow('download appears incomplete');

        spy.mockRestore();
    });

    it('skips duration check when ffprobe fails', async () => {
        const dir = await makeTempDir();
        const infoJson = JSON.stringify({ duration: 60, ext: 'webm', id: 'vid-ffprobe-fail' });
        await writeFile(join(dir, 'vid-ffprobe-fail.info.json'), infoJson);
        await writeFile(join(dir, 'vid-ffprobe-fail.webm'), Buffer.alloc(1000));

        const spy = spyOn(utils, 'runCommand').mockImplementation(async (_cmd) => {
            if (_cmd === 'ffprobe') {
                return { exitCode: 1, stderr: 'ffprobe error', stdout: '' };
            }
            return { exitCode: 0, stderr: '', stdout: '' };
        });

        // Should not throw when ffprobe fails (graceful skip)
        const result = await downloadAudio('https://example.com/video', {
            downloadVideo: false,
            format: 'bestaudio',
            id: 'vid-ffprobe-fail',
            outputDir: dir,
        });
        expect(result.info.id).toBe('vid-ffprobe-fail');

        spy.mockRestore();
    });

    it('uses video format when downloadVideo is true', async () => {
        const dir = await makeTempDir();
        const infoJson = JSON.stringify({ ext: 'mp4', id: 'vid-video' });
        await writeFile(join(dir, 'vid-video.info.json'), infoJson);
        await writeFile(join(dir, 'vid-video.mp4'), Buffer.alloc(1000));

        const spy = spyOn(utils, 'runCommand').mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });

        const result = await downloadAudio('https://example.com/video', {
            downloadVideo: true,
            format: 'bestvideo+bestaudio',
            id: 'vid-video',
            outputDir: dir,
        });

        expect(result.info.id).toBe('vid-video');
        // Should have tried video format - find the yt-dlp call with the video format
        const videoCall = spy.mock.calls.find((call) => (call[1] as string[]).includes('bestvideo+bestaudio/best'));
        expect(videoCall).toBeDefined();

        spy.mockRestore();
    });

    it('passes --force-overwrites when forceOverwrites is true', async () => {
        const dir = await makeTempDir();
        const infoJson = JSON.stringify({ ext: 'webm', id: 'vid-force' });
        await writeFile(join(dir, 'vid-force.info.json'), infoJson);
        await writeFile(join(dir, 'vid-force.webm'), Buffer.alloc(1000));

        const spy = spyOn(utils, 'runCommand').mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });

        await downloadAudio('https://example.com/video', {
            downloadVideo: false,
            forceOverwrites: true,
            format: 'bestaudio',
            id: 'vid-force',
            outputDir: dir,
        });

        // Find the yt-dlp download call (not aria2c check) by looking for '--force-overwrites'
        const downloadCall = spy.mock.calls.find((call) => (call[1] as string[]).includes('--force-overwrites'));
        expect(downloadCall).toBeDefined();
        expect(downloadCall![1] as string[]).toContain('--force-overwrites');

        spy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// resetAria2cCheck
// ---------------------------------------------------------------------------
describe('resetAria2cCheck', () => {
    it('allows re-checking aria2c availability after reset', async () => {
        // Just call reset twice - shouldn't throw
        resetAria2cCheck();
        resetAria2cCheck();
    });
});
