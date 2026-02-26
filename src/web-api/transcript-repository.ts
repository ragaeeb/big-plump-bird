import type { Database } from 'bun:sqlite';
import { extname } from 'node:path';
import { pathExists } from '../core/utils';

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

export type TranscriptWord = {
    b: number;
    e: number;
    w: string;
};

export type TranscriptChannel = {
    channel: string | null;
    channelId: string;
};

export type AudioSource = {
    path: string;
    kind: string;
    mimeType: string;
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
};

type TranscriptListRow = {
    video_id: string;
    title: string | null;
    description: string | null;
    channel: string | null;
    channel_id: string | null;
    language: string;
    text_preview: string;
    source_type: 'url' | 'file';
    source_uri: string;
    status: string;
    created_at: string;
    updated_at: string;
    duration_ms: number | null;
    has_artifact_audio: 0 | 1;
    local_path: string | null;
};

type TranscriptDetailRow = {
    video_id: string;
    title: string | null;
    language: string;
    text: string;
    json: string;
    source_type: 'url' | 'file';
    source_uri: string;
    status: string;
    created_at: string;
    updated_at: string;
    duration_ms: number | null;
};

type AudioRow = {
    uri: string;
    kind: string;
};

type TranscriptChannelRow = {
    channel: string | null;
    channel_id: string;
};

const AUDIO_ARTIFACT_KINDS = ['source_audio', 'audio_wav_enhanced', 'audio_wav'];
const AUDIO_SOURCE_CACHE_TTL_MS = 30_000;
const MAX_AUDIO_SOURCE_CACHE_ENTRIES = 5_000;
const audioSourceCache = new Map<string, { expiresAt: number; value: AudioSource | null }>();

function pruneAudioSourceCache(now: number): void {
    for (const [key, entry] of audioSourceCache) {
        if (entry.expiresAt <= now) {
            audioSourceCache.delete(key);
        }
    }
    while (audioSourceCache.size > MAX_AUDIO_SOURCE_CACHE_ENTRIES) {
        const oldestKey = audioSourceCache.keys().next().value;
        if (oldestKey === undefined) {
            break;
        }
        audioSourceCache.delete(oldestKey);
    }
}

function setCachedAudioSource(videoId: string, value: AudioSource | null, now: number): void {
    audioSourceCache.set(videoId, { expiresAt: now + AUDIO_SOURCE_CACHE_TTL_MS, value });
    pruneAudioSourceCache(now);
}

export function listTranscriptions(
    db: Database,
    params: { limit: number; offset: number; query: string; channelId?: string | null },
): TranscriptListItem[] {
    const limit = Math.max(1, Math.min(200, params.limit));
    const offset = Math.max(0, params.offset);
    const query = params.query.trim();
    const channelId = (params.channelId ?? '').trim();
    const values: Array<string | number> = [];
    const conditions: string[] = [];

    if (query.length > 0) {
        conditions.push(`(
                LOWER(COALESCE(v.title, '')) LIKE LOWER(?)
                OR LOWER(COALESCE(v.source_uri, '')) LIKE LOWER(?)
                OR LOWER(COALESCE(v.description, '')) LIKE LOWER(?)
                OR LOWER(COALESCE(v.channel, '')) LIKE LOWER(?)
                OR LOWER(COALESCE(v.channel_id, '')) LIKE LOWER(?)
                OR EXISTS (
                    SELECT 1
                    FROM segments_fts
                    WHERE segments_fts.video_id = t.video_id
                    AND segments_fts MATCH ?
                )
            )`);
        const like = `%${query}%`;
        values.push(like, like, like, like, like, buildFtsMatchQuery(query));
    }

    if (channelId.length > 0) {
        conditions.push(`COALESCE(v.channel_id, '') = ?`);
        values.push(channelId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(limit, offset);

    const rows = db
        .query(
            `
            SELECT
                t.video_id,
                v.title,
                v.description,
                v.channel,
                v.channel_id,
                t.language,
                SUBSTR(t.text, 1, 220) AS text_preview,
                v.source_type,
                v.source_uri,
                v.status,
                t.created_at,
                v.updated_at,
                v.duration_ms,
                EXISTS (
                    SELECT 1
                    FROM artifacts a
                    WHERE a.video_id = t.video_id
                    AND a.kind IN ('source_audio', 'audio_wav_enhanced', 'audio_wav')
                ) AS has_artifact_audio,
                v.local_path
            FROM transcripts t
            JOIN videos v ON v.video_id = t.video_id
            ${whereClause}
            ORDER BY t.created_at DESC
            LIMIT ? OFFSET ?;
            `,
        )
        .all(...values) as TranscriptListRow[];

    return rows.map((row) => ({
        channel: row.channel,
        channelId: row.channel_id,
        createdAt: row.created_at,
        description: row.description,
        durationMs: row.duration_ms,
        hasAudio: row.has_artifact_audio === 1 || Boolean(row.local_path),
        language: row.language,
        sourceType: row.source_type,
        sourceUri: row.source_uri,
        status: row.status,
        textPreview: row.text_preview,
        title: row.title,
        updatedAt: row.updated_at,
        videoId: row.video_id,
    }));
}

export function listTranscriptChannels(db: Database): TranscriptChannel[] {
    const rows = db
        .query(
            `
            SELECT
                v.channel_id,
                MAX(v.channel) AS channel
            FROM transcripts t
            JOIN videos v ON v.video_id = t.video_id
            WHERE COALESCE(v.channel_id, '') <> ''
            GROUP BY v.channel_id
            ORDER BY LOWER(COALESCE(MAX(v.channel), v.channel_id)) ASC;
            `,
        )
        .all() as TranscriptChannelRow[];

    return rows.map((row) => ({
        channel: row.channel,
        channelId: row.channel_id,
    }));
}

export async function getTranscriptDetail(db: Database, videoId: string): Promise<TranscriptDetail | null> {
    const row = db
        .query(
            `
            SELECT
                t.video_id,
                v.title,
                t.language,
                t.text,
                t.json,
                v.source_type,
                v.source_uri,
                v.status,
                t.created_at,
                v.updated_at,
                v.duration_ms
            FROM transcripts t
            JOIN videos v ON v.video_id = t.video_id
            WHERE t.video_id = ?
            LIMIT 1;
            `,
        )
        .get(videoId) as TranscriptDetailRow | null;

    if (!row) {
        return null;
    }

    const words = parseCompactWords(row.json);
    const audioKind = await getAudioKind(db, videoId);
    return {
        audioKind,
        createdAt: row.created_at,
        durationMs: row.duration_ms,
        hasAudio: audioKind !== null,
        language: row.language,
        sourceType: row.source_type,
        sourceUri: row.source_uri,
        status: row.status,
        text: row.text,
        title: row.title,
        updatedAt: row.updated_at,
        videoId: row.video_id,
        words,
    };
}

export async function resolveAudioSource(db: Database, videoId: string): Promise<AudioSource | null> {
    const now = Date.now();
    pruneAudioSourceCache(now);
    const cached = audioSourceCache.get(videoId);
    if (cached && cached.expiresAt > now) {
        return cached.value;
    }

    const candidates = getAudioCandidates(db, videoId);
    for (const candidate of candidates) {
        if (!(await pathExists(candidate.uri))) {
            continue;
        }
        const source = {
            kind: candidate.kind,
            mimeType: guessMimeType(candidate.uri),
            path: candidate.uri,
        };
        setCachedAudioSource(videoId, source, now);
        return source;
    }

    setCachedAudioSource(videoId, null, now);
    return null;
}

async function getAudioKind(db: Database, videoId: string): Promise<string | null> {
    const candidates = getAudioCandidates(db, videoId);
    for (const candidate of candidates) {
        if (await pathExists(candidate.uri)) {
            return candidate.kind;
        }
    }
    return null;
}

function getAudioCandidates(db: Database, videoId: string): AudioRow[] {
    const artifactRows = db
        .query(
            `
            SELECT uri, kind
            FROM artifacts
            WHERE video_id = ?
            AND kind IN ('source_audio', 'audio_wav_enhanced', 'audio_wav')
            ORDER BY
                CASE kind
                    WHEN 'source_audio' THEN 0
                    WHEN 'audio_wav_enhanced' THEN 1
                    WHEN 'audio_wav' THEN 2
                    ELSE 9
                END,
                id DESC;
            `,
        )
        .all(videoId) as AudioRow[];

    if (artifactRows.length > 0) {
        return artifactRows;
    }

    const localRow = db.query(`SELECT local_path FROM videos WHERE video_id = ? LIMIT 1;`).get(videoId) as {
        local_path: string | null;
    } | null;
    if (!localRow?.local_path) {
        return [];
    }

    return [
        {
            kind: 'local_path',
            uri: localRow.local_path,
        },
    ];
}

function buildFtsMatchQuery(query: string): string {
    return query
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((term) => `"${term.replaceAll('"', '""')}"`)
        .join(' ');
}

function parseCompactWords(jsonText: string): TranscriptWord[] {
    try {
        const parsed = JSON.parse(jsonText) as {
            words?: Array<{ b?: number; e?: number; w?: string }>;
            segments?: Array<{ words?: Array<{ start?: number; end?: number; word?: string }> }>;
        };
        if (Array.isArray(parsed.words)) {
            return parsed.words
                .map((word) => ({
                    b: Number(word.b),
                    e: Number(word.e),
                    w: String(word.w ?? '').trim(),
                }))
                .filter((word) => Number.isFinite(word.b) && Number.isFinite(word.e) && word.w.length > 0);
        }

        if (!Array.isArray(parsed.segments)) {
            return [];
        }

        const words: TranscriptWord[] = [];
        for (const segment of parsed.segments) {
            if (!Array.isArray(segment.words)) {
                continue;
            }
            for (const word of segment.words) {
                if (typeof word.start !== 'number' || typeof word.end !== 'number' || typeof word.word !== 'string') {
                    continue;
                }
                const clean = word.word.trim();
                if (clean.length === 0) {
                    continue;
                }
                words.push({
                    b: Math.round(word.start * 1000),
                    e: Math.round(word.end * 1000),
                    w: clean,
                });
            }
        }
        return words;
    } catch {
        return [];
    }
}

function guessMimeType(path: string): string {
    const extension = extname(path).toLowerCase();
    switch (extension) {
        case '.webm':
            return 'audio/webm';
        case '.wav':
            return 'audio/wav';
        case '.mp3':
            return 'audio/mpeg';
        case '.m4a':
            return 'audio/mp4';
        case '.ogg':
        case '.oga':
            return 'audio/ogg';
        case '.opus':
            return 'audio/ogg; codecs=opus';
        case '.flac':
            return 'audio/flac';
        case '.mp4':
            return 'audio/mp4';
        default:
            return 'application/octet-stream';
    }
}

export function getAudioArtifactKinds(): string[] {
    return AUDIO_ARTIFACT_KINDS;
}
