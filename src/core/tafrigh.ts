import { init, type Segment, transcribe } from 'tafrigh';

export type TafrighTranscriptResult = {
    language: string;
    segments: {
        video_id: string;
        start_ms: number;
        end_ms: number;
        text: string;
    }[];
    words: {
        word: string;
        start_ms: number;
        end_ms: number;
    }[];
};

/**
 * Runs a tafrigh (wit.ai) transcription on the given audio file path.
 * The language is determined by the wit.ai API key app's configured language.
 *
 * @param audioPath - Path to the audio file to transcribe (any ffmpeg-supported format)
 * @param apiKeys   - One or more wit.ai API keys to use for transcription
 * @param videoId   - The video ID to attach to returned segment records
 * @param language  - Language code to store in the result (e.g. "ar", "en"). Does NOT
 *                    override the language of the wit.ai app — it is used for DB storage only.
 * @returns Parsed transcript data ready for DB insertion
 */
export async function runTafrigh(
    audioPath: string,
    apiKeys: string[],
    videoId: string,
    language: string,
): Promise<TafrighTranscriptResult> {
    if (apiKeys.length === 0) {
        throw new Error('[tafrigh] No wit.ai API keys provided.');
    }

    init({ apiKeys });

    console.log(`[tafrigh] Transcribing ${audioPath} with ${apiKeys.length} API key(s)...`);

    const rawSegments: Segment[] = await transcribe(audioPath);

    console.log(`[tafrigh] Received ${rawSegments.length} segment(s).`);

    const segments: TafrighTranscriptResult['segments'] = [];
    const words: TafrighTranscriptResult['words'] = [];

    for (const seg of rawSegments) {
        const normalized = normalizeSegment(seg);
        if (!normalized) {
            continue;
        }

        segments.push({
            end_ms: normalized.endMs,
            start_ms: normalized.startMs,
            text: normalized.text,
            video_id: videoId,
        });

        pushSegmentWords(seg, normalized, words);
    }

    return { language, segments, words };
}

function normalizeSegment(seg: Segment): { startMs: number; endMs: number; text: string } | null {
    const startMs = Math.round(seg.start * 1000);
    const endMs = Math.round(seg.end * 1000);
    const text = seg.text.trim();
    if (text.length === 0) {
        return null;
    }
    return { endMs, startMs, text };
}

function pushSegmentWords(
    seg: Segment,
    normalized: { startMs: number; endMs: number; text: string },
    words: TafrighTranscriptResult['words'],
): void {
    if (!Array.isArray(seg.tokens) || seg.tokens.length === 0) {
        words.push({
            end_ms: normalized.endMs,
            start_ms: normalized.startMs,
            word: normalized.text,
        });
        return;
    }

    for (const token of seg.tokens) {
        const tokenWord = toTokenWord(token);
        if (tokenWord) {
            words.push(tokenWord);
        }
    }
}

function toTokenWord(token: {
    text: string;
    start: number;
    end: number;
}): TafrighTranscriptResult['words'][number] | null {
    const tokenText = token.text.trim();
    if (tokenText.length === 0) {
        return null;
    }

    const tokenStartMs = Math.round(token.start * 1000);
    const tokenEndMs = Math.round(token.end * 1000);
    if (!Number.isFinite(tokenStartMs) || !Number.isFinite(tokenEndMs) || tokenEndMs < tokenStartMs) {
        return null;
    }

    return {
        end_ms: tokenEndMs,
        start_ms: tokenStartMs,
        word: tokenText,
    };
}
