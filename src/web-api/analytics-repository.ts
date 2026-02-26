import type { Database } from 'bun:sqlite';

type CountRow = {
    count: number;
};

type DailyRow = {
    day: string;
    transcripts: number;
    minutes: number;
};

type DistributionRow = {
    key: string;
    count: number;
};

type JobDurationRow = {
    video_id: string;
    label: string;
    total_ms: number | null;
};

type EnhancementMetricRow = {
    run_id: number;
    video_id: string;
    started_at: string;
    snr_db: number | null;
    metrics_json: string;
};

type EnhancementSummaryRow = {
    total: number;
    applied: number;
    skipped: number;
    failed: number;
};

export type AnalyticsPoint = {
    day: string;
    transcripts: number;
    minutes: number;
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

export function getAnalytics(db: Database): AnalyticsPayload {
    const transcriptsTotal = readCount(db, `SELECT COUNT(*) AS count FROM transcripts;`);
    const videosTotal = readCount(db, `SELECT COUNT(*) AS count FROM videos;`);

    const transcribedHours = (
        db
            .query(
                `
                SELECT COALESCE(SUM(COALESCE(v.duration_ms, 0)) / 3600000.0, 0) AS value
                FROM transcripts t
                JOIN videos v ON v.video_id = t.video_id;
                `,
            )
            .get() as { value: number }
    ).value;

    const rawDaily = db
        .query(
            `
            SELECT
                SUBSTR(t.created_at, 1, 10) AS day,
                COUNT(*) AS transcripts,
                ROUND(COALESCE(SUM(COALESCE(v.duration_ms, 0)) / 60000.0, 0), 2) AS minutes
            FROM transcripts t
            JOIN videos v ON v.video_id = t.video_id
            GROUP BY SUBSTR(t.created_at, 1, 10)
            ORDER BY day DESC
            LIMIT 30;
            `,
        )
        .all() as DailyRow[];

    const daily = fillDailySeries(rawDaily, 30);
    const averagePerDayLast7 = round2(daily.slice(-7).reduce((total, point) => total + point.transcripts, 0) / 7);

    const languages = readDistribution(
        db,
        `
        SELECT t.language AS key, COUNT(*) AS count
        FROM transcripts t
        GROUP BY t.language
        ORDER BY count DESC
        LIMIT 10;
        `,
    );

    const sourceTypes = readDistribution(
        db,
        `
        SELECT v.source_type AS key, COUNT(*) AS count
        FROM transcripts t
        JOIN videos v ON v.video_id = t.video_id
        GROUP BY v.source_type
        ORDER BY count DESC;
        `,
    );

    const videoStatuses = readDistribution(
        db,
        `
        SELECT v.status AS key, COUNT(*) AS count
        FROM videos v
        GROUP BY v.status
        ORDER BY count DESC;
        `,
    );

    const enhancementSummary = (db
        .query(
            `
                SELECT
                    COUNT(*) AS total,
                    SUM(CASE WHEN er.applied = 1 THEN 1 ELSE 0 END) AS applied,
                    SUM(CASE WHEN er.status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
                    SUM(CASE WHEN er.status IN ('failed', 'error') THEN 1 ELSE 0 END) AS failed
                FROM enhancement_runs er;
                `,
        )
        .get() as EnhancementSummaryRow) ?? { applied: 0, failed: 0, skipped: 0, total: 0 };

    const enhancementOutcomes: AnalyticsDistribution[] =
        enhancementSummary.total === 0
            ? []
            : [
                  { count: enhancementSummary.applied ?? 0, key: 'applied' },
                  { count: enhancementSummary.skipped ?? 0, key: 'skipped' },
                  { count: enhancementSummary.failed ?? 0, key: 'failed' },
              ].filter((item) => item.count > 0);

    const durationBuckets = buildDurationBuckets(
        readDistribution(
            db,
            `
            SELECT
                CASE
                    WHEN v.duration_ms < 300000 THEN '<5m'
                    WHEN v.duration_ms < 900000 THEN '5-15m'
                    WHEN v.duration_ms < 1800000 THEN '15-30m'
                    WHEN v.duration_ms < 3600000 THEN '30-60m'
                    ELSE '60m+'
                END AS key,
                COUNT(*) AS count
            FROM videos v
            WHERE v.duration_ms IS NOT NULL
            GROUP BY key;
            `,
        ),
    );

    const jobDurations = (
        db
            .query(
                `
                SELECT
                    v.video_id,
                    COALESCE(v.title, v.video_id) AS label,
                    CAST(
                        CASE
                            WHEN v.created_at IS NULL OR v.updated_at IS NULL THEN NULL
                            WHEN (julianday(v.updated_at) - julianday(v.created_at)) < 0 THEN 0
                            ELSE (julianday(v.updated_at) - julianday(v.created_at)) * 86400000
                        END AS INTEGER
                    ) AS total_ms
                FROM videos v
                JOIN transcripts t ON t.video_id = v.video_id
                ORDER BY t.created_at DESC
                LIMIT 40;
                `,
            )
            .all() as JobDurationRow[]
    )
        .filter((row) => typeof row.total_ms === 'number' && Number.isFinite(row.total_ms) && row.total_ms >= 0)
        .map((row) => ({
            label: row.label,
            totalMs: row.total_ms as number,
            videoId: row.video_id,
        }))
        .reverse();

    const enhancementMetrics = (
        db
            .query(
                `
                SELECT
                    er.id AS run_id,
                    er.video_id,
                    er.started_at,
                    er.snr_db,
                    er.metrics_json
                FROM enhancement_runs er
                ORDER BY er.id DESC
                LIMIT 120;
                `,
            )
            .all() as EnhancementMetricRow[]
    )
        .map((row) => toEnhancementMetricPoint(row))
        .filter(
            (point) =>
                point.analysisDurationMs !== null ||
                point.processingMs !== null ||
                point.speechRatio !== null ||
                point.snrDb !== null,
        )
        .reverse();

    const speechRatios = enhancementMetrics
        .map((point) => point.speechRatio)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const signalNoiseShare =
        speechRatios.length === 0
            ? []
            : (() => {
                  const avgSpeechRatio = speechRatios.reduce((total, value) => total + value, 0) / speechRatios.length;
                  const signalPct = round2(avgSpeechRatio * 100);
                  return [
                      { key: 'signal' as const, value: signalPct },
                      { key: 'noise' as const, value: round2(100 - signalPct) },
                  ];
              })();

    return {
        daily,
        durationBuckets,
        enhancementMetrics,
        enhancementOutcomes,
        jobDurations,
        languages,
        signalNoiseShare,
        sourceTypes,
        summary: {
            averagePerDayLast7,
            transcribedHours: round2(transcribedHours),
            transcriptsTotal,
            videosTotal,
        },
        videoStatuses,
    };
}

function readCount(db: Database, query: string): number {
    return (db.query(query).get() as CountRow).count;
}

function readDistribution(db: Database, query: string): AnalyticsDistribution[] {
    return (db.query(query).all() as DistributionRow[]).map((row) => ({
        count: row.count,
        key: row.key || 'unknown',
    }));
}

function fillDailySeries(rows: DailyRow[], days: number): AnalyticsPoint[] {
    const byDay = new Map(rows.map((row) => [row.day, row]));
    const points: AnalyticsPoint[] = [];
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    for (let offset = days - 1; offset >= 0; offset -= 1) {
        const dayDate = new Date(today);
        dayDate.setUTCDate(today.getUTCDate() - offset);
        const day = dayDate.toISOString().slice(0, 10);
        const row = byDay.get(day);
        points.push({
            day,
            minutes: row?.minutes ?? 0,
            transcripts: row?.transcripts ?? 0,
        });
    }
    return points;
}

function buildDurationBuckets(raw: AnalyticsDistribution[]): AnalyticsDistribution[] {
    const order = ['<5m', '5-15m', '15-30m', '30-60m', '60m+'];
    const counts = new Map(raw.map((row) => [row.key, row.count]));
    return order.map((key) => ({
        count: counts.get(key) ?? 0,
        key,
    }));
}

function toEnhancementMetricPoint(row: EnhancementMetricRow): EnhancementMetricPoint {
    const metrics = parseMetricsJson(row.metrics_json);
    return {
        analysisDurationMs: metrics.analysis_duration_ms,
        processingMs: metrics.processing_ms,
        runId: row.run_id,
        snrDb: row.snr_db,
        speechRatio: metrics.speech_ratio,
        startedAt: row.started_at,
        videoId: row.video_id,
    };
}

function parseMetricsJson(metricsJson: string): {
    speech_ratio: number | null;
    analysis_duration_ms: number | null;
    processing_ms: number | null;
} {
    try {
        const parsed = JSON.parse(metricsJson) as {
            speech_ratio?: number;
            analysis_duration_ms?: number;
            processing_ms?: number;
        };
        return {
            analysis_duration_ms: toNullableNumber(parsed.analysis_duration_ms),
            processing_ms: toNullableNumber(parsed.processing_ms),
            speech_ratio: toNullableNumber(parsed.speech_ratio),
        };
    } catch {
        return {
            analysis_duration_ms: null,
            processing_ms: null,
            speech_ratio: null,
        };
    }
}

function toNullableNumber(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    return value;
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}
