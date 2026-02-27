import type { ApiOptions } from '@/lib/api';

export const FALLBACK_OPTIONS: ApiOptions = {
    defaults: {
        attenLimDb: 12,
        dereverbMode: 'off',
        engine: 'whisperx',
        enhancementMode: 'off',
        language: 'en',
        modelPath: 'turbo',
        outputFormats: ['json'],
        snrSkipThresholdDb: 15,
        sourceClass: 'auto',
    },
    dereverbModes: [
        { label: 'Off', value: 'off' },
        { label: 'Auto', value: 'auto' },
        { label: 'On', value: 'on' },
    ],
    engines: [
        { label: 'WhisperX (local)', value: 'whisperx' },
        { label: 'Tafrigh (wit.ai)', value: 'tafrigh' },
    ],
    enhancementModes: [
        { label: 'Off', value: 'off' },
        { label: 'Auto', value: 'auto' },
        { label: 'On', value: 'on' },
        { label: 'Analyze only', value: 'analyze-only' },
    ],
    languages: [
        { label: 'English', value: 'en' },
        { label: 'Arabic', value: 'ar' },
        { label: 'Auto detect', value: 'auto' },
    ],
    models: [
        { label: 'turbo (fast large-v3)', value: 'turbo' },
        { label: 'large-v3', value: 'large-v3' },
    ],
    outputFormats: [
        { label: 'JSON', value: 'json' },
        { label: 'TXT', value: 'txt' },
        { label: 'SRT', value: 'srt' },
        { label: 'VTT', value: 'vtt' },
        { label: 'TSV', value: 'tsv' },
    ],
    sourceClasses: [
        { label: 'Auto', value: 'auto' },
        { label: 'Studio', value: 'studio' },
        { label: 'Podium', value: 'podium' },
        { label: 'Far-field / audience', value: 'far-field' },
        { label: 'Cassette', value: 'cassette' },
    ],
};
