import { describe, expect, it, spyOn } from 'bun:test';
import { convertToWav } from '../../src/core/ffmpeg';
import * as utils from '../../src/core/utils';

describe('convertToWav', () => {
    it('resolves successfully when ffmpeg exits 0', async () => {
        const spy = spyOn(utils, 'runCommand').mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });
        await expect(convertToWav('/input/audio.mp3', '/output/audio.wav')).resolves.toBeUndefined();
        expect(spy).toHaveBeenCalledWith('ffmpeg', expect.arrayContaining(['/input/audio.mp3', '/output/audio.wav']));
        spy.mockRestore();
    });

    it('throws with exit code when ffmpeg fails and stderr is empty', async () => {
        const spy = spyOn(utils, 'runCommand').mockResolvedValue({ exitCode: 1, stderr: '', stdout: '' });
        await expect(convertToWav('/bad/input.mp3', '/output/audio.wav')).rejects.toThrow(
            'ffmpeg failed with exit code 1',
        );
        spy.mockRestore();
    });

    it('throws with stderr detail when ffmpeg fails with error output', async () => {
        const spy = spyOn(utils, 'runCommand').mockResolvedValue({
            exitCode: 1,
            stderr: 'Invalid data found when processing input',
            stdout: '',
        });
        await expect(convertToWav('/bad/input.mp3', '/output/audio.wav')).rejects.toThrow(
            'Invalid data found when processing input',
        );
        spy.mockRestore();
    });

    it('passes the correct ffmpeg arguments for 16kHz mono PCM conversion', async () => {
        const spy = spyOn(utils, 'runCommand').mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });
        await convertToWav('/in/file.m4a', '/out/file.wav');
        const args = spy.mock.calls[0][1] as string[];
        expect(args).toContain('-ar');
        expect(args[args.indexOf('-ar') + 1]).toBe('16000');
        expect(args).toContain('-ac');
        expect(args[args.indexOf('-ac') + 1]).toBe('1');
        expect(args).toContain('-c:a');
        expect(args[args.indexOf('-c:a') + 1]).toBe('pcm_s16le');
        spy.mockRestore();
    });
});
