import type { Database } from 'bun:sqlite';

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

export type VideoRetryCandidate = {
    videoId: string;
    sourceUri: string;
    status: string;
    runLanguage: string | null;
    runModelPath: string | null;
    runOutputFormatsJson: string | null;
    runEnhancementJson: string | null;
    latestEnhancementConfigJson: string | null;
};

export type VideoDeleteCandidate = {
    videoId: string;
    sourceType: 'url' | 'file';
    sourceUri: string;
    status: string;
    localPath: string | null;
    artifactUris: string[];
};

type VideoRow = {
    video_id: string;
    source_type: 'url' | 'file';
    source_uri: string;
    title: string | null;
    status: string;
    language: string | null;
    transcript_preview: string | null;
    updated_at: string;
};

type VideoRetryRow = {
    video_id: string;
    source_uri: string;
    status: string;
    run_language: string | null;
    run_model_path: string | null;
    run_output_formats_json: string | null;
    run_enhancement_json: string | null;
    latest_enhancement_config_json: string | null;
};

type VideoDeleteRow = {
    video_id: string;
    source_type: 'url' | 'file';
    source_uri: string;
    status: string;
    local_path: string | null;
};

export function listRecentVideos(db: Database, limit: number): VideoListItem[] {
    const safeLimit = Math.max(1, Math.min(200, limit));
    const rows = db
        .query(
            `
            SELECT
                v.video_id,
                v.source_type,
                v.source_uri,
                v.title,
                v.status,
                t.language,
                SUBSTR(t.text, 1, 160) AS transcript_preview,
                v.updated_at
            FROM videos v
            LEFT JOIN transcripts t ON t.video_id = v.video_id
            ORDER BY v.updated_at DESC
            LIMIT ?;
            `,
        )
        .all(safeLimit) as VideoRow[];

    return rows.map((row) => ({
        language: row.language,
        sourceType: row.source_type,
        sourceUri: row.source_uri,
        status: row.status,
        title: row.title,
        transcriptPreview: row.transcript_preview,
        updatedAt: row.updated_at,
        videoId: row.video_id,
    }));
}

export function getVideoRetryCandidate(db: Database, videoId: string): VideoRetryCandidate | null {
    const row = db
        .query(
            `
            SELECT
                v.video_id,
                v.source_uri,
                v.status,
                v.run_language,
                v.run_model_path,
                v.run_output_formats_json,
                v.run_enhancement_json,
                (
                    SELECT er.config_json
                    FROM enhancement_runs er
                    WHERE er.video_id = v.video_id
                    ORDER BY er.started_at DESC
                    LIMIT 1
                ) AS latest_enhancement_config_json
            FROM videos v
            WHERE v.video_id = ?
            LIMIT 1;
            `,
        )
        .get(videoId) as VideoRetryRow | null;

    if (!row) {
        return null;
    }

    return {
        latestEnhancementConfigJson: row.latest_enhancement_config_json,
        runEnhancementJson: row.run_enhancement_json,
        runLanguage: row.run_language,
        runModelPath: row.run_model_path,
        runOutputFormatsJson: row.run_output_formats_json,
        sourceUri: row.source_uri,
        status: row.status,
        videoId: row.video_id,
    };
}

export function getVideoDeleteCandidate(db: Database, videoId: string): VideoDeleteCandidate | null {
    const row = db
        .query(
            `
            SELECT v.video_id, v.source_type, v.source_uri, v.status, v.local_path
            FROM videos v
            WHERE v.video_id = ?
            LIMIT 1;
            `,
        )
        .get(videoId) as VideoDeleteRow | null;

    if (!row) {
        return null;
    }

    const artifactRows = db.query(`SELECT a.uri FROM artifacts a WHERE a.video_id = ?;`).all(videoId) as Array<{
        uri: string;
    }>;

    return {
        artifactUris: artifactRows.map((artifact) => artifact.uri).filter((uri) => uri.length > 0),
        localPath: row.local_path,
        sourceType: row.source_type,
        sourceUri: row.source_uri,
        status: row.status,
        videoId: row.video_id,
    };
}
