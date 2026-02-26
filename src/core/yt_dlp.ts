import type { Stats } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand } from './utils';

export type YtDlpInfo = {
    id: string;
    title?: string;
    description?: string;
    webpage_url?: string;
    uploader?: string;
    uploader_id?: string;
    channel?: string;
    channel_id?: string;
    duration?: number;
    upload_date?: string;
    timestamp?: number;
    filesize?: number;
    filesize_approx?: number;
    chapters?: Array<{
        start_time?: number;
        end_time?: number;
        title?: string;
    }>;
    ext?: string;
};

export async function getYtDlpId(url: string): Promise<string> {
    const result = await runCommand('yt-dlp', ['--no-playlist', '--skip-download', '--print', '%(id)s', url]);
    if (result.exitCode !== 0) {
        throw new Error(`yt-dlp failed to get id: exit code ${result.exitCode}`);
    }
    const lines = result.stdout.trim().split('\n').filter(Boolean);
    if (lines.length === 0) {
        throw new Error('yt-dlp returned empty id');
    }
    return lines[lines.length - 1];
}

export async function expandYtDlpUrls(url: string): Promise<string[]> {
    const result = await runCommand('yt-dlp', [
        '--yes-playlist',
        '--flat-playlist',
        '--skip-download',
        '--print',
        '%(webpage_url)s',
        url,
    ]);
    if (result.exitCode !== 0) {
        throw new Error(`yt-dlp failed to expand URL list: exit code ${result.exitCode}`);
    }

    const expanded = result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^https?:\/\//i.test(line));

    if (expanded.length === 0) {
        return [url];
    }

    return Array.from(new Set(expanded));
}

export async function downloadAudio(
    url: string,
    opts: {
        outputDir: string;
        format: string;
        downloadVideo: boolean;
        id: string;
        forceOverwrites?: boolean;
    },
): Promise<{
    info: YtDlpInfo;
    infoJson: string;
    filePath: string;
    infoJsonPath: string;
}> {
    const outputTemplate = join(opts.outputDir, '%(id)s.%(ext)s');
    const baseArgs = [
        '--no-playlist',
        '--write-info-json',
        '--continue',
        '--part',
        '--retries',
        '5',
        '--fragment-retries',
        '5',
        '--file-access-retries',
        '10',
        '--retry-sleep',
        '3',
        '--socket-timeout',
        '30',
        '--concurrent-fragments',
        '1',
        '--force-ipv4',
        '-o',
        outputTemplate,
    ];

    if (opts.forceOverwrites) {
        baseArgs.push('--force-overwrites');
    }

    const attempts: Array<{ name: string; args: string[] }> = [];
    const ffmpegReconnectArgs = 'ffmpeg_i:-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 30';
    if (opts.downloadVideo) {
        attempts.push({
            args: [...baseArgs, '-f', 'bestvideo+bestaudio/best', url],
            name: 'default-video',
        });
        attempts.push({
            args: [
                ...baseArgs,
                '--downloader',
                'ffmpeg',
                '--downloader-args',
                ffmpegReconnectArgs,
                '-f',
                'bestvideo+bestaudio/best',
                url,
            ],
            name: 'ffmpeg-downloader-video',
        });
    } else {
        const audioFormats = buildAudioFormatLadder(opts.format);
        attempts.push({
            args: [...baseArgs, '-f', audioFormats[0], url],
            name: 'requested-audio-format',
        });
        attempts.push({
            args: [...baseArgs, '-f', audioFormats[1], url],
            name: 'lower-opus-96',
        });
        attempts.push({
            args: [...baseArgs, '-f', audioFormats[2], url],
            name: 'lower-opus-64',
        });
        attempts.push({
            args: [...baseArgs, '-f', audioFormats[3], url],
            name: 'higher-opus-any-abr',
        });
        if (await canUseAria2c()) {
            attempts.push({
                args: [
                    ...baseArgs,
                    '--downloader',
                    'aria2c',
                    '--downloader-args',
                    'aria2c:-c -x8 -s8 -k1M --file-allocation=none --summary-interval=0',
                    '-f',
                    audioFormats[1],
                    url,
                ],
                name: 'aria2c-lower-opus-96',
            });
        }
        attempts.push({
            args: [
                ...baseArgs,
                '--downloader',
                'ffmpeg',
                '--downloader-args',
                ffmpegReconnectArgs,
                '-f',
                audioFormats[1],
                url,
            ],
            name: 'ffmpeg-downloader-requested-format',
        });
        attempts.push({
            args: [...baseArgs, '-f', 'bestaudio[ext=m4a]/bestaudio/best', url],
            name: 'fallback-m4a-audio-format',
        });
    }

    let downloadSucceeded = false;
    let lastExitCode = -1;
    for (let i = 0; i < attempts.length; i++) {
        const attempt = attempts[i];
        console.log(`[yt-dlp] Download attempt ${i + 1}/${attempts.length}: ${attempt.name}`);
        const result = await runCommand('yt-dlp', attempt.args, { stream: true });
        const combinedOutput = `${result.stdout}\n${result.stderr}`;
        if (wasInterruptedByUser(combinedOutput)) {
            throw new Error('yt-dlp download interrupted by user');
        }
        lastExitCode = result.exitCode;
        if (result.exitCode === 0) {
            downloadSucceeded = true;
            break;
        }
        console.warn(`[yt-dlp] Attempt failed (${attempt.name}): exit code ${result.exitCode}`);
    }

    if (!downloadSucceeded) {
        throw new Error(`yt-dlp download failed after ${attempts.length} attempts: exit code ${lastExitCode}`);
    }

    const infoJsonPath = join(opts.outputDir, `${opts.id}.info.json`);
    const infoRaw = await readFile(infoJsonPath, 'utf-8');
    const info = JSON.parse(infoRaw) as YtDlpInfo;
    if (!info.id) {
        throw new Error('yt-dlp info.json missing id');
    }
    const ext = info.ext ?? 'webm';
    const filePath = join(opts.outputDir, `${info.id}.${ext}`);
    await validateDownloadedMedia(filePath, info);
    return { filePath, info, infoJson: infoRaw, infoJsonPath };
}

function buildAudioFormatLadder(requestedFormat: string): [string, string, string, string] {
    const normalized = requestedFormat.trim();
    const requested = normalized.length > 0 ? normalized : 'bestaudio';
    const lower96 = 'bestaudio[acodec=opus][abr<=96]/bestaudio[abr<=96]/bestaudio[acodec=opus]/bestaudio';
    const lower64 = 'bestaudio[acodec=opus][abr<=64]/bestaudio[abr<=64]/bestaudio[acodec=opus]/bestaudio';
    const higherAnyAbr = 'bestaudio[acodec=opus]/bestaudio';
    return [requested, lower96, lower64, higherAnyAbr];
}

let aria2cCheckPromise: Promise<boolean> | null = null;

async function canUseAria2c(): Promise<boolean> {
    aria2cCheckPromise ??= runCommand('aria2c', ['--version'])
        .then((result) => result.exitCode === 0)
        .catch(() => false);
    return aria2cCheckPromise;
}

export function resetAria2cCheck(): void {
    aria2cCheckPromise = null;
}

function wasInterruptedByUser(output: string): boolean {
    return /interrupted by user/i.test(output) || /keyboardinterrupt/i.test(output);
}

async function validateDownloadedMedia(filePath: string, info: YtDlpInfo): Promise<void> {
    let fileStats: Stats;
    try {
        fileStats = await stat(filePath);
    } catch {
        throw new Error(`yt-dlp download did not produce output file: ${filePath}`);
    }

    const expectedBytes = info.filesize ?? info.filesize_approx ?? null;
    if (typeof expectedBytes === 'number' && expectedBytes > 0) {
        const minAcceptableBytes = Math.floor(expectedBytes * 0.95);
        if (fileStats.size < minAcceptableBytes) {
            throw new Error(
                `yt-dlp download appears incomplete: got ${fileStats.size} bytes, expected about ${expectedBytes} bytes`,
            );
        }
    }

    if (typeof info.duration === 'number' && info.duration > 0) {
        const actualDurationSec = await readMediaDurationSec(filePath);
        if (actualDurationSec !== null) {
            const minAcceptableDuration = info.duration * 0.95;
            if (actualDurationSec < minAcceptableDuration) {
                throw new Error(
                    `yt-dlp download appears incomplete: got duration ${actualDurationSec.toFixed(2)}s, expected about ${info.duration.toFixed(2)}s`,
                );
            }
        }
    }
}

async function readMediaDurationSec(filePath: string): Promise<number | null> {
    const result = await runCommand('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
    ]);
    if (result.exitCode !== 0) {
        return null;
    }
    const parsed = Number.parseFloat(result.stdout.trim());
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
    }
    return parsed;
}
