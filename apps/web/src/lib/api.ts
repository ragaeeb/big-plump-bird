export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type JobKind = 'url' | 'path';

export type JobOverrides = {
    language?: string;
    modelPath?: string;
    outputFormats?: string[];
    enhancementMode?: 'off' | 'auto' | 'on' | 'analyze-only';
    sourceClass?: 'auto' | 'studio' | 'podium' | 'far-field' | 'cassette';
    dereverbMode?: 'off' | 'auto' | 'on';
    attenLimDb?: number;
    snrSkipThresholdDb?: number;
};

export type CreateJobRequest = {
    input: string;
    force?: boolean;
    overrides?: JobOverrides;
};

export type TranscriptionJob = {
    id: string;
    kind: JobKind;
    input: string;
    force: boolean;
    status: JobStatus;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    error: string | null;
    overrides: JobOverrides;
};

export type VideoListItem = {
    videoId: string;
    title: string | null;
    sourceType: 'url' | 'file';
    sourceUri: string;
    status: string;
    language: string | null;
    transcriptPreview: string | null;
    updatedAt: string;
};

export type TranscriptWord = {
    b: number;
    e: number;
    w: string;
};

export type TranscriptListItem = {
    videoId: string;
    title: string | null;
    description: string | null;
    channel: string | null;
    channelId: string | null;
    language: string;
    textPreview: string;
    sourceType: 'url' | 'file';
    sourceUri: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    durationMs: number | null;
    hasAudio: boolean;
};

export type TranscriptChannel = {
    channel: string | null;
    channelId: string;
};

export type TranscriptDetail = {
    videoId: string;
    title: string | null;
    language: string;
    text: string;
    words: TranscriptWord[];
    sourceType: 'url' | 'file';
    sourceUri: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    durationMs: number | null;
    hasAudio: boolean;
    audioKind: string | null;
    audioUrl: string | null;
};

export type DashboardStats = {
    activeJobs: number;
    audioBackedTranscripts: number;
    transcriptsTotal: number;
    videosTotal: number;
};

export type AnalyticsDistribution = {
    key: string;
    count: number;
};

export type JobDurationPoint = {
    videoId: string;
    label: string;
    totalMs: number;
};

export type EnhancementMetricPoint = {
    runId: number;
    videoId: string;
    startedAt: string;
    snrDb: number | null;
    speechRatio: number | null;
    analysisDurationMs: number | null;
    processingMs: number | null;
};

export type SignalNoiseSharePoint = {
    key: 'signal' | 'noise';
    value: number;
};

export type AnalyticsPoint = {
    day: string;
    transcripts: number;
    minutes: number;
};

export type AnalyticsSummary = {
    transcriptsTotal: number;
    videosTotal: number;
    transcribedHours: number;
    averagePerDayLast7: number;
};

export type AnalyticsPayload = {
    summary: AnalyticsSummary;
    daily: AnalyticsPoint[];
    languages: AnalyticsDistribution[];
    sourceTypes: AnalyticsDistribution[];
    videoStatuses: AnalyticsDistribution[];
    enhancementOutcomes: AnalyticsDistribution[];
    durationBuckets: AnalyticsDistribution[];
    jobDurations: JobDurationPoint[];
    enhancementMetrics: EnhancementMetricPoint[];
    signalNoiseShare: SignalNoiseSharePoint[];
};

export type HealthStatus = {
    ok: boolean;
    time: string;
};

export type OptionValue = {
    label: string;
    value: string;
};

export type ApiOptions = {
    defaults: {
        language: string;
        modelPath: string;
        outputFormats: string[];
        enhancementMode: 'off' | 'auto' | 'on' | 'analyze-only';
        sourceClass: 'auto' | 'studio' | 'podium' | 'far-field' | 'cassette';
        dereverbMode: 'off' | 'auto' | 'on';
        attenLimDb: number;
        snrSkipThresholdDb: number;
    };
    languages: OptionValue[];
    models: OptionValue[];
    enhancementModes: OptionValue[];
    sourceClasses: OptionValue[];
    dereverbModes: OptionValue[];
    outputFormats: OptionValue[];
};

type ApiError = {
    error: string;
};

const API_BASE = import.meta.env.VITE_BPB_API_BASE?.trim() ?? '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
            'content-type': 'application/json',
            ...(init?.headers ?? {}),
        },
    });
    if (!response.ok) {
        let errorMessage = `Request failed: ${response.status}`;
        try {
            const parsed = (await response.json()) as ApiError;
            if (typeof parsed.error === 'string' && parsed.error.length > 0) {
                errorMessage = parsed.error;
            }
        } catch {
            // Ignore JSON parse failures and keep generic HTTP error.
        }
        throw new Error(errorMessage);
    }
    return (await response.json()) as T;
}

export async function getOptions(): Promise<ApiOptions> {
    return request<ApiOptions>('/api/options');
}

export async function getJobs(): Promise<TranscriptionJob[]> {
    const response = await request<{ jobs: TranscriptionJob[] }>('/api/jobs');
    return response.jobs;
}

export async function createJob(payload: CreateJobRequest): Promise<TranscriptionJob> {
    const response = await request<{ job: TranscriptionJob }>('/api/jobs', {
        body: JSON.stringify(payload),
        method: 'POST',
    });
    return response.job;
}

export async function retryVideo(videoId: string): Promise<TranscriptionJob> {
    const response = await request<{ job: TranscriptionJob }>(`/api/videos/${encodeURIComponent(videoId)}/retry`, {
        method: 'POST',
    });
    return response.job;
}

export async function deleteVideo(videoId: string): Promise<void> {
    await request<{ deleted: boolean; videoId: string }>(`/api/videos/${encodeURIComponent(videoId)}`, {
        method: 'DELETE',
    });
}

export async function getRecentVideos(): Promise<VideoListItem[]> {
    const response = await request<{ videos: VideoListItem[] }>('/api/videos?limit=30');
    return response.videos;
}

export async function getStats(): Promise<DashboardStats> {
    const response = await request<{ stats: DashboardStats }>('/api/stats');
    return response.stats;
}

export async function getAnalytics(): Promise<AnalyticsPayload> {
    const response = await request<{ analytics: AnalyticsPayload }>('/api/analytics');
    return response.analytics;
}

export async function getHealth(): Promise<HealthStatus> {
    return request<HealthStatus>('/api/health');
}

export async function getTranscriptions(options?: {
    query?: string;
    channelId?: string | null;
    limit?: number;
}): Promise<TranscriptListItem[]> {
    const params = new URLSearchParams();
    params.set('limit', String(options?.limit ?? 75));

    const query = (options?.query ?? '').trim();
    if (query.length > 0) {
        params.set('q', query);
    }

    const channelId = (options?.channelId ?? '').trim();
    if (channelId.length > 0) {
        params.set('channel_id', channelId);
    }

    const response = await request<{ transcripts: TranscriptListItem[] }>(`/api/transcripts?${params.toString()}`);
    return response.transcripts;
}

export async function getTranscriptChannels(): Promise<TranscriptChannel[]> {
    const response = await request<{ channels: TranscriptChannel[] }>('/api/channels');
    return response.channels;
}

export async function getTranscriptById(videoId: string): Promise<TranscriptDetail> {
    const response = await request<{ transcript: TranscriptDetail }>(`/api/transcripts/${encodeURIComponent(videoId)}`);
    return response.transcript;
}

export function resolveApiUrl(path: string): string {
    return `${API_BASE}${path}`;
}
