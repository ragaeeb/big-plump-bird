import { loadConfig } from '../core/config';
import { ensureModelReady } from '../core/model';
import { runPipeline } from '../core/pipeline';
import {
    applyJobOverrides,
    type CreateJobRequest,
    classifyJobInput,
    type TranscriptionJob,
    toRunOptions,
} from './job-logic';

const JOB_RETENTION_MS = 6 * 60 * 60 * 1000;
const MAX_TERMINAL_JOBS = 2_000;

export type JobManagerOptions = {
    configPath: string;
    concurrency: number;
};

export class JobManager {
    readonly #jobs = new Map<string, TranscriptionJob>();
    readonly #queue: string[] = [];
    #running = 0;
    readonly #configPath: string;
    readonly #concurrency: number;

    constructor(options: JobManagerOptions) {
        this.#configPath = options.configPath;
        this.#concurrency = Math.max(1, options.concurrency);
    }

    listJobs(limit = 50): TranscriptionJob[] {
        this.#pruneJobs();
        return Array.from(this.#jobs.values())
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
            .slice(0, Math.max(0, limit));
    }

    getJob(jobId: string): TranscriptionJob | null {
        return this.#jobs.get(jobId) ?? null;
    }

    findActiveJobByInput(input: string): TranscriptionJob | null {
        this.#pruneJobs();
        for (const job of this.#jobs.values()) {
            if ((job.status === 'queued' || job.status === 'running') && job.input === input) {
                return job;
            }
        }
        return null;
    }

    countActiveJobs(): number {
        this.#pruneJobs();
        let count = 0;
        for (const job of this.#jobs.values()) {
            if (job.status === 'queued' || job.status === 'running') {
                count += 1;
            }
        }
        return count;
    }

    createJob(payload: CreateJobRequest): TranscriptionJob {
        this.#pruneJobs();
        const input = payload.input.trim();
        if (input.length === 0) {
            throw new Error('input is required');
        }

        const now = new Date().toISOString();
        const job: TranscriptionJob = {
            createdAt: now,
            error: null,
            finishedAt: null,
            force: payload.force ?? false,
            id: crypto.randomUUID(),
            input,
            kind: classifyJobInput(input),
            overrides: payload.overrides ?? {},
            startedAt: null,
            status: 'queued',
        };

        this.#jobs.set(job.id, job);
        this.#queue.push(job.id);
        this.#pump();
        return job;
    }

    #updateJob(jobId: string, update: Partial<TranscriptionJob>): void {
        const current = this.#jobs.get(jobId);
        if (!current) {
            return;
        }
        this.#jobs.set(jobId, { ...current, ...update });
    }

    #pump(): void {
        while (this.#running < this.#concurrency && this.#queue.length > 0) {
            const nextJobId = this.#queue.shift();
            if (!nextJobId) {
                break;
            }
            this.#running += 1;
            void this.#runJob(nextJobId);
        }
    }

    async #runJob(jobId: string): Promise<void> {
        const job = this.#jobs.get(jobId);
        if (!job) {
            this.#running = Math.max(0, this.#running - 1);
            this.#pump();
            return;
        }

        this.#updateJob(job.id, {
            error: null,
            startedAt: new Date().toISOString(),
            status: 'running',
        });

        try {
            const baseConfig = await loadConfig(this.#configPath);
            const runConfig = await ensureModelReady(applyJobOverrides(baseConfig, job.overrides));
            await runPipeline(runConfig, toRunOptions(job));
            this.#updateJob(job.id, {
                finishedAt: new Date().toISOString(),
                status: 'succeeded',
            });
        } catch (error) {
            this.#updateJob(job.id, {
                error: error instanceof Error ? error.message : String(error),
                finishedAt: new Date().toISOString(),
                status: 'failed',
            });
        } finally {
            this.#running = Math.max(0, this.#running - 1);
            this.#pruneJobs();
            this.#pump();
        }
    }

    #pruneJobs(): void {
        const now = Date.now();
        const terminalJobs: Array<{ finishedAtMs: number; id: string }> = [];

        for (const [jobId, job] of this.#jobs) {
            if (job.status !== 'succeeded' && job.status !== 'failed') {
                continue;
            }

            const parsedFinishedAt = job.finishedAt ? Date.parse(job.finishedAt) : now;
            const finishedAtMs = Number.isFinite(parsedFinishedAt) ? parsedFinishedAt : now;
            if (Number.isFinite(finishedAtMs) && now - finishedAtMs > JOB_RETENTION_MS) {
                this.#jobs.delete(jobId);
                continue;
            }

            terminalJobs.push({ finishedAtMs, id: jobId });
        }

        if (terminalJobs.length <= MAX_TERMINAL_JOBS) {
            return;
        }

        terminalJobs.sort((left, right) => left.finishedAtMs - right.finishedAtMs);
        for (const stale of terminalJobs.slice(0, terminalJobs.length - MAX_TERMINAL_JOBS)) {
            this.#jobs.delete(stale.id);
        }
    }
}
