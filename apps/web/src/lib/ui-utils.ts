import type { JobStatus, TranscriptWord } from '@/lib/api';

export function normalizeOutputFormats(input: string): string[] {
    return Array.from(
        new Set(
            input
                .split(',')
                .map((value) => value.trim().toLowerCase())
                .filter(Boolean),
        ),
    );
}

export function formatDate(value: string | null): string {
    if (!value) {
        return '-';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '-';
    }
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'short',
        timeStyle: 'short',
    }).format(date);
}

export function formatTimestampMs(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds
            .toString()
            .padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function statusClassName(status: string): string {
    switch (status as JobStatus | string) {
        case 'running':
        case 'processing':
            return 'bg-blue-500/10 text-blue-700';
        case 'succeeded':
        case 'done':
            return 'bg-emerald-500/10 text-emerald-700';
        case 'failed':
        case 'error':
            return 'bg-red-500/10 text-red-700';
        default:
            return 'bg-muted text-muted-foreground';
    }
}

export function findActiveWordIndex(words: TranscriptWord[], timeMs: number): number {
    if (words.length === 0 || timeMs < words[0].b) {
        return -1;
    }
    let left = 0;
    let right = words.length - 1;
    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const word = words[mid];
        if (timeMs < word.b) {
            right = mid - 1;
            continue;
        }
        if (timeMs > word.e) {
            left = mid + 1;
            continue;
        }
        return mid;
    }
    return -1;
}

export function buildWordTrackDataUri(words: TranscriptWord[]): string {
    if (words.length === 0) {
        return 'data:text/vtt;charset=utf-8,WEBVTT%0A%0A';
    }

    const cues = words
        .map(
            (word, index) =>
                `${index + 1}\n${toVttTime(word.b)} --> ${toVttTime(word.e)}\n${word.w.replace(/\n/g, ' ')}\n`,
        )
        .join('\n');
    const vtt = `WEBVTT\n\n${cues}`;
    return `data:text/vtt;charset=utf-8,${encodeURIComponent(vtt)}`;
}

function toVttTime(ms: number): string {
    const clamped = Math.max(0, ms);
    const hours = Math.floor(clamped / 3_600_000);
    const minutes = Math.floor((clamped % 3_600_000) / 60_000);
    const seconds = Math.floor((clamped % 60_000) / 1000);
    const milliseconds = clamped % 1000;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds
        .toString()
        .padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
}
