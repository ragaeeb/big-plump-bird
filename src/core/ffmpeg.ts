import { runCommand } from './utils';

export async function convertToWav(inputPath: string, outputPath: string): Promise<void> {
    const args = [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        inputPath,
        '-vn',
        '-ar',
        '16000',
        '-ac',
        '1',
        '-c:a',
        'pcm_s16le',
        outputPath,
    ];
    const result = await runCommand('ffmpeg', args);
    if (result.exitCode !== 0) {
        const detail = result.stderr.trim();
        throw new Error(`ffmpeg failed with exit code ${result.exitCode}${detail ? `: ${detail}` : ''}`);
    }
}
