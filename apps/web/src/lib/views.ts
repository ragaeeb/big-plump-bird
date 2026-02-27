export type AppView = 'new-job' | 'job-queue' | 'recent-videos' | 'transcriptions' | 'analytics' | 'settings';

export const VIEW_META: Record<AppView, { title: string; subtitle: string }> = {
    analytics: {
        subtitle: 'Track throughput, language mix, source mix, and enhancement outcomes.',
        title: 'Analytics',
    },
    'job-queue': {
        subtitle: 'Track active and queued transcription runs.',
        title: 'Job Queue',
    },
    'new-job': {
        subtitle: 'Submit local paths or YouTube URLs for transcription.',
        title: 'New Job',
    },
    'recent-videos': {
        subtitle: 'Browse the latest ingested and processed media.',
        title: 'Recent Videos',
    },
    settings: {
        subtitle: 'Manage local dashboard settings and transcription credentials.',
        title: 'Settings',
    },
    transcriptions: {
        subtitle: 'Inspect transcripts and jump to timestamped words.',
        title: 'Transcriptions',
    },
};
