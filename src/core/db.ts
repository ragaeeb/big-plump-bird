import { Database } from 'bun:sqlite';
import { dirname } from 'node:path';
import { ensureDir } from './utils';

const SCHEMA_VERSION = 3;

export type VideoRecord = {
    video_id: string;
    source_type: 'url' | 'file';
    source_uri: string;
    title?: string | null;
    description?: string | null;
    webpage_url?: string | null;
    uploader?: string | null;
    uploader_id?: string | null;
    channel?: string | null;
    channel_id?: string | null;
    duration_ms?: number | null;
    upload_date?: string | null;
    timestamp?: number | null;
    metadata_json?: string | null;
    local_path?: string | null;
    run_language?: string | null;
    run_engine?: string | null;
    run_engine_version?: string | null;
    run_model_path?: string | null;
    run_output_formats_json?: string | null;
    run_enhancement_json?: string | null;
    status: string;
    error?: string | null;
    created_at: string;
    updated_at: string;
};

export type ArtifactRecord = {
    video_id: string;
    kind: string;
    uri: string;
    size_bytes: number;
    created_at: string;
};

export type SegmentRecord = {
    video_id: string;
    start_ms: number;
    end_ms: number;
    text: string;
    avg_logprob?: number | null;
    no_speech_prob?: number | null;
};

export type ChapterRecord = {
    video_id: string;
    start_ms: number;
    end_ms: number | null;
    title: string;
};

export type EnhancementRunRecord = {
    video_id: string;
    status: string;
    mode: string;
    source_class: string | null;
    snr_db: number | null;
    regime_count: number;
    applied: number;
    skip_reason: string | null;
    duration_ms: number | null;
    metrics_json: string;
    versions_json: string;
    config_json: string;
    started_at: string;
    finished_at: string | null;
    error: string | null;
};

export type EnhancementSegmentRecord = {
    run_id: number;
    segment_index: number;
    start_ms: number;
    end_ms: number;
    noise_rms_db: number | null;
    spectral_centroid_hz: number | null;
    speech_ratio: number | null;
    dereverb_applied: number;
    denoise_applied: number;
    atten_lim_db: number | null;
    processing_ms: number | null;
};

export type TranscriptRecord = {
    video_id: string;
    model: string;
    language: string;
    text: string;
    json: string;
    created_at: string;
};

export async function openDb(dbPath: string): Promise<Database> {
    await ensureDir(dirname(dbPath));
    const db = new Database(dbPath);
    db.exec('PRAGMA journal_mode=WAL;');
    db.exec('PRAGMA synchronous=NORMAL;');

    db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      video_id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_uri TEXT NOT NULL,
      title TEXT,
      description TEXT,
      webpage_url TEXT,
      uploader TEXT,
      uploader_id TEXT,
      channel TEXT,
      channel_id TEXT,
      duration_ms INTEGER,
      upload_date TEXT,
      timestamp INTEGER,
      metadata_json TEXT,
      local_path TEXT,
      run_language TEXT,
      run_engine TEXT,
      run_engine_version TEXT,
      run_model_path TEXT,
      run_output_formats_json TEXT,
      run_enhancement_json TEXT,
      status TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

    db.exec(`
    CREATE TABLE IF NOT EXISTS artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      uri TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

    db.exec(`
    CREATE TABLE IF NOT EXISTS transcripts (
      video_id TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      language TEXT NOT NULL,
      text TEXT NOT NULL,
      json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

    db.exec(`
    CREATE TABLE IF NOT EXISTS segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT NOT NULL,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      text TEXT NOT NULL,
      avg_logprob REAL,
      no_speech_prob REAL
    );
  `);

    db.exec(`
    CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT NOT NULL,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER,
      title TEXT NOT NULL
    );
  `);

    db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(
      text,
      video_id,
      start_ms,
      end_ms,
      content='segments',
      content_rowid='id',
      tokenize='unicode61 remove_diacritics 2'
    );
  `);

    db.exec(`
    CREATE TRIGGER IF NOT EXISTS segments_ai AFTER INSERT ON segments BEGIN
      INSERT INTO segments_fts(rowid, text, video_id, start_ms, end_ms)
      VALUES (new.id, new.text, new.video_id, new.start_ms, new.end_ms);
    END;
  `);

    db.exec(`
    CREATE TRIGGER IF NOT EXISTS segments_ad AFTER DELETE ON segments BEGIN
      INSERT INTO segments_fts(segments_fts, rowid, text, video_id, start_ms, end_ms)
      VALUES('delete', old.id, old.text, old.video_id, old.start_ms, old.end_ms);
    END;
  `);

    db.exec(`
    CREATE TRIGGER IF NOT EXISTS segments_au AFTER UPDATE ON segments BEGIN
      INSERT INTO segments_fts(segments_fts, rowid, text, video_id, start_ms, end_ms)
      VALUES('delete', old.id, old.text, old.video_id, old.start_ms, old.end_ms);
      INSERT INTO segments_fts(rowid, text, video_id, start_ms, end_ms)
      VALUES (new.id, new.text, new.video_id, new.start_ms, new.end_ms);
    END;
  `);

    db.exec(`
    CREATE TABLE IF NOT EXISTS enhancement_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT NOT NULL,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      source_class TEXT,
      snr_db REAL,
      regime_count INTEGER NOT NULL,
      applied INTEGER NOT NULL,
      skip_reason TEXT,
      duration_ms INTEGER,
      metrics_json TEXT NOT NULL,
      versions_json TEXT NOT NULL,
      config_json TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      error TEXT
    );
  `);

    db.exec(`
    CREATE TABLE IF NOT EXISTS enhancement_segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      segment_index INTEGER NOT NULL,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      noise_rms_db REAL,
      spectral_centroid_hz REAL,
      speech_ratio REAL,
      dereverb_applied INTEGER NOT NULL,
      denoise_applied INTEGER NOT NULL,
      atten_lim_db REAL,
      processing_ms INTEGER
    );
  `);

    db.exec('CREATE INDEX IF NOT EXISTS idx_videos_source_uri ON videos(source_uri);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_segments_video_id ON segments(video_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_artifacts_video_id ON artifacts(video_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_chapters_video_id ON chapters(video_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_enhancement_runs_video_id ON enhancement_runs(video_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_enhancement_segments_run_id ON enhancement_segments(run_id);');

    applyMigrations(db);

    return db;
}

function applyMigrations(db: Database): void {
    const versionRow = db.query('PRAGMA user_version;').get() as { user_version?: number } | null;
    const currentVersion = Number.isFinite(versionRow?.user_version) ? Number(versionRow?.user_version) : 0;

    if (currentVersion < 1) {
        ensureVideoColumns(db);
    }

    if (currentVersion < 2) {
        db.exec(`INSERT INTO segments_fts(segments_fts) VALUES('rebuild');`);
    }
    if (currentVersion < 3) {
        ensureVideoColumns(db);
    }

    if (currentVersion !== SCHEMA_VERSION) {
        db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
    }
}

function ensureVideoColumns(db: Database): void {
    const columns = db
        .query('PRAGMA table_info(videos);')
        .all()
        .map((row) => (row as { name: string }).name);
    const required: Array<{ name: string; type: string }> = [
        { name: 'description', type: 'TEXT' },
        { name: 'webpage_url', type: 'TEXT' },
        { name: 'uploader_id', type: 'TEXT' },
        { name: 'channel', type: 'TEXT' },
        { name: 'channel_id', type: 'TEXT' },
        { name: 'upload_date', type: 'TEXT' },
        { name: 'timestamp', type: 'INTEGER' },
        { name: 'metadata_json', type: 'TEXT' },
        { name: 'run_language', type: 'TEXT' },
        { name: 'run_engine', type: 'TEXT' },
        { name: 'run_engine_version', type: 'TEXT' },
        { name: 'run_model_path', type: 'TEXT' },
        { name: 'run_output_formats_json', type: 'TEXT' },
        { name: 'run_enhancement_json', type: 'TEXT' },
    ];
    for (const column of required) {
        if (!columns.includes(column.name)) {
            db.exec(`ALTER TABLE videos ADD COLUMN ${column.name} ${column.type};`);
        }
    }
}

export function hasTranscript(db: Database, videoId: string): boolean {
    const row = db.query('SELECT 1 FROM transcripts WHERE video_id = ? LIMIT 1;').get(videoId);
    return Boolean(row);
}

const UPSERT_VIDEO_SQL = `
      INSERT INTO videos (
        video_id, source_type, source_uri, title, description, webpage_url, uploader, uploader_id,
        channel, channel_id, duration_ms, upload_date, timestamp, metadata_json,
        local_path, run_language, run_engine, run_engine_version, run_model_path,
        run_output_formats_json, run_enhancement_json, status, error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(video_id) DO UPDATE SET
        source_type=excluded.source_type,
        source_uri=excluded.source_uri,
        title=excluded.title,
        description=excluded.description,
        webpage_url=excluded.webpage_url,
        uploader=excluded.uploader,
        uploader_id=excluded.uploader_id,
        channel=excluded.channel,
        channel_id=excluded.channel_id,
        duration_ms=excluded.duration_ms,
        upload_date=excluded.upload_date,
        timestamp=excluded.timestamp,
        metadata_json=excluded.metadata_json,
        local_path=excluded.local_path,
        run_language=excluded.run_language,
        run_engine=excluded.run_engine,
        run_engine_version=excluded.run_engine_version,
        run_model_path=excluded.run_model_path,
        run_output_formats_json=excluded.run_output_formats_json,
        run_enhancement_json=excluded.run_enhancement_json,
        status=excluded.status,
        error=excluded.error,
        updated_at=excluded.updated_at;
    `;

export function upsertVideo(db: Database, record: VideoRecord): void {
    db.query(UPSERT_VIDEO_SQL).run(...toVideoUpsertValues(record));
}

function toNullable<T>(value: T | null | undefined): T | null {
    return value ?? null;
}

function toVideoUpsertValues(
    record: VideoRecord,
): [
    string,
    'url' | 'file',
    string,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    number | null,
    string | null,
    number | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string,
    string | null,
    string,
    string,
] {
    return [
        record.video_id,
        record.source_type,
        record.source_uri,
        toNullable(record.title),
        toNullable(record.description),
        toNullable(record.webpage_url),
        toNullable(record.uploader),
        toNullable(record.uploader_id),
        toNullable(record.channel),
        toNullable(record.channel_id),
        toNullable(record.duration_ms),
        toNullable(record.upload_date),
        toNullable(record.timestamp),
        toNullable(record.metadata_json),
        toNullable(record.local_path),
        toNullable(record.run_language),
        toNullable(record.run_engine),
        toNullable(record.run_engine_version),
        toNullable(record.run_model_path),
        toNullable(record.run_output_formats_json),
        toNullable(record.run_enhancement_json),
        record.status,
        toNullable(record.error),
        record.created_at,
        record.updated_at,
    ];
}

export function updateVideoStatus(db: Database, videoId: string, status: string, error?: string | null): void {
    db.query(`UPDATE videos SET status = ?, error = ?, updated_at = ? WHERE video_id = ?;`).run(
        status,
        error ?? null,
        new Date().toISOString(),
        videoId,
    );
}

export function insertTranscript(db: Database, record: TranscriptRecord): void {
    db.query(
        `
      INSERT INTO transcripts (video_id, model, language, text, json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(video_id) DO UPDATE SET
        model=excluded.model,
        language=excluded.language,
        text=excluded.text,
        json=excluded.json,
        created_at=excluded.created_at;
    `,
    ).run(record.video_id, record.model, record.language, record.text, record.json, record.created_at);
}

export function insertArtifacts(db: Database, artifacts: ArtifactRecord[]): void {
    if (artifacts.length === 0) {
        return;
    }
    const stmt = db.prepare(
        `INSERT INTO artifacts (video_id, kind, uri, size_bytes, created_at)
     VALUES (?, ?, ?, ?, ?);`,
    );
    const tx = db.transaction((rows: ArtifactRecord[]) => {
        for (const row of rows) {
            stmt.run(row.video_id, row.kind, row.uri, row.size_bytes, row.created_at);
        }
    });
    tx(artifacts);
}

export function insertSegments(db: Database, segments: SegmentRecord[]): void {
    if (segments.length === 0) {
        return;
    }
    const stmt = db.prepare(
        `INSERT INTO segments (video_id, start_ms, end_ms, text, avg_logprob, no_speech_prob)
     VALUES (?, ?, ?, ?, ?, ?);`,
    );
    const tx = db.transaction((rows: SegmentRecord[]) => {
        for (const row of rows) {
            stmt.run(
                row.video_id,
                row.start_ms,
                row.end_ms,
                row.text,
                row.avg_logprob ?? null,
                row.no_speech_prob ?? null,
            );
        }
    });
    tx(segments);
}

export function insertChapters(db: Database, chapters: ChapterRecord[]): void {
    if (chapters.length === 0) {
        return;
    }
    const stmt = db.prepare(`INSERT INTO chapters (video_id, start_ms, end_ms, title) VALUES (?, ?, ?, ?);`);
    const tx = db.transaction((rows: ChapterRecord[]) => {
        for (const row of rows) {
            stmt.run(row.video_id, row.start_ms, row.end_ms ?? null, row.title);
        }
    });
    tx(chapters);
}

export function deleteVideoData(db: Database, videoId: string): void {
    const tx = db.transaction((id: string) => {
        db.query(
            'DELETE FROM enhancement_segments WHERE run_id IN (SELECT id FROM enhancement_runs WHERE video_id = ?);',
        ).run(id);
        db.query('DELETE FROM enhancement_runs WHERE video_id = ?;').run(id);
        db.query('DELETE FROM segments WHERE video_id = ?;').run(id);
        db.query('DELETE FROM chapters WHERE video_id = ?;').run(id);
        db.query('DELETE FROM transcripts WHERE video_id = ?;').run(id);
        db.query('DELETE FROM artifacts WHERE video_id = ?;').run(id);
    });
    tx(videoId);
}

export function deleteVideoFully(db: Database, videoId: string): void {
    deleteVideoData(db, videoId);
    db.query('DELETE FROM videos WHERE video_id = ?;').run(videoId);
}

export type SearchResult = {
    video_id: string;
    start_ms: number;
    end_ms: number;
    text: string;
    score: number;
};

export function searchSegments(db: Database, query: string, limit: number): SearchResult[] {
    const stmt = db.prepare(
        `
      SELECT video_id, start_ms, end_ms, text, bm25(segments_fts) AS score
      FROM segments_fts
      WHERE segments_fts MATCH ?
      ORDER BY score
      LIMIT ?;
    `,
    );
    try {
        return stmt.all(query, limit) as SearchResult[];
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid search query for FTS MATCH: ${message}`);
    }
}

export function insertEnhancementRun(db: Database, record: EnhancementRunRecord): number {
    db.query(
        `INSERT INTO enhancement_runs (
       video_id, status, mode, source_class, snr_db, regime_count,
       applied, skip_reason, duration_ms, metrics_json, versions_json,
       config_json, started_at, finished_at, error
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    ).run(
        record.video_id,
        record.status,
        record.mode,
        record.source_class,
        record.snr_db,
        record.regime_count,
        record.applied,
        record.skip_reason,
        record.duration_ms,
        record.metrics_json,
        record.versions_json,
        record.config_json,
        record.started_at,
        record.finished_at,
        record.error,
    );
    const row = db.query('SELECT last_insert_rowid() AS id;').get() as {
        id: number;
    };
    return row.id;
}

export function insertEnhancementSegments(db: Database, segments: EnhancementSegmentRecord[]): void {
    if (segments.length === 0) {
        return;
    }
    const stmt = db.prepare(
        `INSERT INTO enhancement_segments (
       run_id, segment_index, start_ms, end_ms, noise_rms_db,
       spectral_centroid_hz, speech_ratio, dereverb_applied,
       denoise_applied, atten_lim_db, processing_ms
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    );
    const tx = db.transaction((rows: EnhancementSegmentRecord[]) => {
        for (const r of rows) {
            stmt.run(
                r.run_id,
                r.segment_index,
                r.start_ms,
                r.end_ms,
                r.noise_rms_db,
                r.spectral_centroid_hz,
                r.speech_ratio,
                r.dereverb_applied,
                r.denoise_applied,
                r.atten_lim_db,
                r.processing_ms,
            );
        }
    });
    tx(segments);
}
