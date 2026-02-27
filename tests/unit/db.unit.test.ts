import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
    ArtifactRecord,
    ChapterRecord,
    EnhancementRunRecord,
    EnhancementSegmentRecord,
    SegmentRecord,
    VideoRecord,
} from '../../src/core/db';
import {
    deleteVideoData,
    deleteVideoFully,
    hasTranscript,
    insertArtifacts,
    insertChapters,
    insertEnhancementRun,
    insertEnhancementSegments,
    insertSegments,
    insertTranscript,
    openDb,
    searchSegments,
    updateVideoStatus,
    upsertVideo,
} from '../../src/core/db';

const tempDirs: string[] = [];

afterEach(async () => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (!dir) {
            continue;
        }
        await rm(dir, { force: true, recursive: true });
    }
});

async function makeDb() {
    const dir = await mkdtemp(join(tmpdir(), 'bpb-db-test-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'test.sqlite');
    const db = await openDb(dbPath);
    return { db, dbPath, dir };
}

function makeVideo(overrides: Partial<VideoRecord> = {}): VideoRecord {
    const now = new Date().toISOString();
    return {
        created_at: now,
        source_type: 'file',
        source_uri: '/path/to/file.wav',
        status: 'processing',
        updated_at: now,
        video_id: 'test-video-001',
        ...overrides,
    };
}

describe('openDb', () => {
    it('creates the database and all tables', async () => {
        const { db } = await makeDb();
        const tables = db
            .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .all()
            .map((r) => (r as { name: string }).name);
        expect(tables).toContain('videos');
        expect(tables).toContain('transcripts');
        expect(tables).toContain('segments');
        expect(tables).toContain('artifacts');
        expect(tables).toContain('chapters');
        expect(tables).toContain('enhancement_runs');
        expect(tables).toContain('enhancement_segments');
        db.close(false);
    });

    it('is idempotent - opening same db twice works', async () => {
        const { dbPath } = await makeDb();
        const db2 = await openDb(dbPath);
        db2.close(false);
    });
});

describe('upsertVideo + hasTranscript', () => {
    it('inserts a video and reports no transcript initially', async () => {
        const { db } = await makeDb();
        upsertVideo(db, makeVideo({ video_id: 'vid-001' }));
        expect(hasTranscript(db, 'vid-001')).toBe(false);
        db.close(false);
    });

    it('updates existing video on conflict', async () => {
        const { db } = await makeDb();
        upsertVideo(db, makeVideo({ status: 'processing', video_id: 'vid-update' }));
        upsertVideo(db, makeVideo({ status: 'done', video_id: 'vid-update' }));
        const row = db.query('SELECT status FROM videos WHERE video_id = ?').get('vid-update') as { status: string };
        expect(row.status).toBe('done');
        db.close(false);
    });

    it('stores optional fields as NULL when omitted', async () => {
        const { db } = await makeDb();
        upsertVideo(db, makeVideo({ video_id: 'vid-null' }));
        const row = db.query('SELECT title, description FROM videos WHERE video_id = ?').get('vid-null') as {
            description: null;
            title: null;
        };
        expect(row.title).toBeNull();
        expect(row.description).toBeNull();
        db.close(false);
    });
});

describe('hasTranscript', () => {
    it('returns true after inserting a transcript', async () => {
        const { db } = await makeDb();
        upsertVideo(db, makeVideo({ video_id: 'vid-tx' }));
        insertTranscript(db, {
            created_at: new Date().toISOString(),
            json: '{"language":"en","words":[]}',
            language: 'en',
            model: 'turbo',
            text: 'hello',
            video_id: 'vid-tx',
        });
        expect(hasTranscript(db, 'vid-tx')).toBe(true);
        db.close(false);
    });

    it('returns false for a non-existent video', async () => {
        const { db } = await makeDb();
        expect(hasTranscript(db, 'ghost-video')).toBe(false);
        db.close(false);
    });
});

describe('updateVideoStatus', () => {
    it('updates status and clears error', async () => {
        const { db } = await makeDb();
        upsertVideo(db, makeVideo({ error: 'oops', status: 'error', video_id: 'vid-status' }));
        updateVideoStatus(db, 'vid-status', 'done', null);
        const row = db.query('SELECT status, error FROM videos WHERE video_id = ?').get('vid-status') as {
            error: null;
            status: string;
        };
        expect(row.status).toBe('done');
        expect(row.error).toBeNull();
        db.close(false);
    });

    it('updates status with an error message', async () => {
        const { db } = await makeDb();
        upsertVideo(db, makeVideo({ video_id: 'vid-err' }));
        updateVideoStatus(db, 'vid-err', 'error', 'something went wrong');
        const row = db.query('SELECT status, error FROM videos WHERE video_id = ?').get('vid-err') as {
            error: string;
            status: string;
        };
        expect(row.status).toBe('error');
        expect(row.error).toBe('something went wrong');
        db.close(false);
    });
});

describe('insertArtifacts', () => {
    it('inserts multiple artifacts', async () => {
        const { db } = await makeDb();
        upsertVideo(db, makeVideo({ video_id: 'vid-art' }));
        const artifacts: ArtifactRecord[] = [
            {
                created_at: new Date().toISOString(),
                kind: 'transcript_json',
                size_bytes: 100,
                uri: '/a.json',
                video_id: 'vid-art',
            },
            {
                created_at: new Date().toISOString(),
                kind: 'transcript_txt',
                size_bytes: 50,
                uri: '/a.txt',
                video_id: 'vid-art',
            },
        ];
        insertArtifacts(db, artifacts);
        const count = (
            db.query('SELECT COUNT(*) as c FROM artifacts WHERE video_id = ?').get('vid-art') as { c: number }
        ).c;
        expect(count).toBe(2);
        db.close(false);
    });

    it('does nothing when given empty array', async () => {
        const { db } = await makeDb();
        insertArtifacts(db, []);
        const count = (db.query('SELECT COUNT(*) as c FROM artifacts').get() as { c: number }).c;
        expect(count).toBe(0);
        db.close(false);
    });
});

describe('insertSegments', () => {
    it('inserts segments and they are searchable via FTS', async () => {
        const { db } = await makeDb();
        upsertVideo(db, makeVideo({ video_id: 'vid-seg' }));
        const segments: SegmentRecord[] = [
            { end_ms: 3000, start_ms: 0, text: 'Hello world', video_id: 'vid-seg' },
            { end_ms: 6000, start_ms: 3000, text: 'Goodbye world', video_id: 'vid-seg' },
        ];
        insertSegments(db, segments);
        const count = (
            db.query('SELECT COUNT(*) as c FROM segments WHERE video_id = ?').get('vid-seg') as { c: number }
        ).c;
        expect(count).toBe(2);
        db.close(false);
    });

    it('does nothing when given empty array', async () => {
        const { db } = await makeDb();
        insertSegments(db, []);
        const count = (db.query('SELECT COUNT(*) as c FROM segments').get() as { c: number }).c;
        expect(count).toBe(0);
        db.close(false);
    });
});

describe('insertChapters', () => {
    it('inserts chapters', async () => {
        const { db } = await makeDb();
        upsertVideo(db, makeVideo({ video_id: 'vid-ch' }));
        const chapters: ChapterRecord[] = [
            { end_ms: 60000, start_ms: 0, title: 'Introduction', video_id: 'vid-ch' },
            { end_ms: null, start_ms: 60000, title: 'Main Content', video_id: 'vid-ch' },
        ];
        insertChapters(db, chapters);
        const count = (db.query('SELECT COUNT(*) as c FROM chapters WHERE video_id = ?').get('vid-ch') as { c: number })
            .c;
        expect(count).toBe(2);
        db.close(false);
    });

    it('does nothing when given empty array', async () => {
        const { db } = await makeDb();
        insertChapters(db, []);
        const count = (db.query('SELECT COUNT(*) as c FROM chapters').get() as { c: number }).c;
        expect(count).toBe(0);
        db.close(false);
    });
});

describe('deleteVideoData', () => {
    it('removes all derived data but leaves the video row', async () => {
        const { db } = await makeDb();
        upsertVideo(db, makeVideo({ video_id: 'vid-del' }));
        insertTranscript(db, {
            created_at: new Date().toISOString(),
            json: '{}',
            language: 'en',
            model: 'turbo',
            text: 'text',
            video_id: 'vid-del',
        });
        insertSegments(db, [{ end_ms: 1000, start_ms: 0, text: 'hi', video_id: 'vid-del' }]);
        insertArtifacts(db, [
            {
                created_at: new Date().toISOString(),
                kind: 'transcript_json',
                size_bytes: 10,
                uri: '/f.json',
                video_id: 'vid-del',
            },
        ]);

        deleteVideoData(db, 'vid-del');

        expect(hasTranscript(db, 'vid-del')).toBe(false);
        const segCount = (
            db.query('SELECT COUNT(*) as c FROM segments WHERE video_id = ?').get('vid-del') as { c: number }
        ).c;
        expect(segCount).toBe(0);
        const artCount = (
            db.query('SELECT COUNT(*) as c FROM artifacts WHERE video_id = ?').get('vid-del') as { c: number }
        ).c;
        expect(artCount).toBe(0);
        // Video row still exists
        const vidRow = db.query('SELECT video_id FROM videos WHERE video_id = ?').get('vid-del');
        expect(vidRow).not.toBeNull();
        db.close(false);
    });
});

describe('deleteVideoFully', () => {
    it('removes the video row and all derived data', async () => {
        const { db } = await makeDb();
        upsertVideo(db, makeVideo({ video_id: 'vid-full-del' }));
        insertTranscript(db, {
            created_at: new Date().toISOString(),
            json: '{}',
            language: 'en',
            model: 'turbo',
            text: 'text',
            video_id: 'vid-full-del',
        });

        deleteVideoFully(db, 'vid-full-del');

        const vidRow = db.query('SELECT video_id FROM videos WHERE video_id = ?').get('vid-full-del');
        expect(vidRow).toBeNull();
        expect(hasTranscript(db, 'vid-full-del')).toBe(false);
        db.close(false);
    });
});

describe('searchSegments', () => {
    it('returns matching segments', async () => {
        const { db } = await makeDb();
        upsertVideo(db, makeVideo({ video_id: 'vid-search' }));
        insertSegments(db, [
            { end_ms: 3000, start_ms: 0, text: 'the quick brown fox', video_id: 'vid-search' },
            { end_ms: 6000, start_ms: 3000, text: 'jumped over the lazy dog', video_id: 'vid-search' },
        ]);
        const results = searchSegments(db, 'fox', 10);
        expect(results.length).toBe(1);
        expect(results[0].text).toBe('the quick brown fox');
        db.close(false);
    });

    it('returns empty array when no match', async () => {
        const { db } = await makeDb();
        upsertVideo(db, makeVideo({ video_id: 'vid-no-match' }));
        insertSegments(db, [{ end_ms: 3000, start_ms: 0, text: 'hello world', video_id: 'vid-no-match' }]);
        const results = searchSegments(db, 'zzznomatch', 10);
        expect(results.length).toBe(0);
        db.close(false);
    });

    it('throws a descriptive error for invalid FTS query', async () => {
        const { db } = await makeDb();
        // FTS MATCH with unbalanced quotes / invalid syntax
        expect(() => searchSegments(db, '"unclosed quote', 10)).toThrow('Invalid search query for FTS MATCH');
        db.close(false);
    });

    it('respects the limit parameter', async () => {
        const { db } = await makeDb();
        upsertVideo(db, makeVideo({ video_id: 'vid-limit' }));
        const segments: SegmentRecord[] = Array.from({ length: 5 }, (_, i) => ({
            end_ms: (i + 1) * 1000,
            start_ms: i * 1000,
            text: `hello segment ${i}`,
            video_id: 'vid-limit',
        }));
        insertSegments(db, segments);
        const results = searchSegments(db, 'hello', 3);
        expect(results.length).toBeLessThanOrEqual(3);
        db.close(false);
    });
});

describe('insertEnhancementRun + insertEnhancementSegments', () => {
    it('inserts an enhancement run and returns its id', async () => {
        const { db } = await makeDb();
        upsertVideo(db, makeVideo({ video_id: 'vid-enh' }));
        const run: EnhancementRunRecord = {
            applied: 1,
            config_json: '{}',
            duration_ms: 1200,
            error: null,
            finished_at: new Date().toISOString(),
            metrics_json: '{}',
            mode: 'auto',
            regime_count: 2,
            skip_reason: null,
            snr_db: 10.5,
            source_class: 'auto',
            started_at: new Date().toISOString(),
            status: 'completed',
            versions_json: '{}',
            video_id: 'vid-enh',
        };
        const runId = insertEnhancementRun(db, run);
        expect(typeof runId).toBe('number');
        expect(runId).toBeGreaterThan(0);
        db.close(false);
    });

    it('inserts enhancement segments associated to a run', async () => {
        const { db } = await makeDb();
        upsertVideo(db, makeVideo({ video_id: 'vid-enh-seg' }));
        const runId = insertEnhancementRun(db, {
            applied: 0,
            config_json: '{}',
            duration_ms: null,
            error: null,
            finished_at: null,
            metrics_json: '{}',
            mode: 'auto',
            regime_count: 1,
            skip_reason: 'snr_above_threshold',
            snr_db: 20.0,
            source_class: null,
            started_at: new Date().toISOString(),
            status: 'skipped',
            versions_json: '{}',
            video_id: 'vid-enh-seg',
        });

        const segs: EnhancementSegmentRecord[] = [
            {
                atten_lim_db: 12,
                denoise_applied: 1,
                dereverb_applied: 0,
                end_ms: 5000,
                noise_rms_db: -30.5,
                processing_ms: 300,
                run_id: runId,
                segment_index: 0,
                spectral_centroid_hz: 2000.0,
                speech_ratio: 0.7,
                start_ms: 0,
            },
        ];
        insertEnhancementSegments(db, segs);
        const count = (
            db.query('SELECT COUNT(*) as c FROM enhancement_segments WHERE run_id = ?').get(runId) as { c: number }
        ).c;
        expect(count).toBe(1);
        db.close(false);
    });

    it('does nothing when given empty segments array', async () => {
        const { db } = await makeDb();
        insertEnhancementSegments(db, []);
        const count = (db.query('SELECT COUNT(*) as c FROM enhancement_segments').get() as { c: number }).c;
        expect(count).toBe(0);
        db.close(false);
    });
});
