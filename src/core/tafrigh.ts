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
        const startMs = Math.round(seg.start * 1000);
        const endMs = Math.round(seg.end * 1000);
        const text = seg.text.trim();

        if (text.length === 0) {
            continue;
        }

        segments.push({
            end_ms: endMs,
            start_ms: startMs,
            text,
            video_id: videoId,
        });

        // Extract word-level tokens when available
        if (Array.isArray(seg.tokens) && seg.tokens.length > 0) {
            for (const token of seg.tokens) {
                const tokenText = token.text.trim();
                if (tokenText.length === 0) {
                    continue;
                }
                const tokenStartMs = Math.round(token.start * 1000);
                const tokenEndMs = Math.round(token.end * 1000);
                if (!Number.isFinite(tokenStartMs) || !Number.isFinite(tokenEndMs) || tokenEndMs < tokenStartMs) {
                    continue;
                }
                words.push({
                    end_ms: tokenEndMs,
                    start_ms: tokenStartMs,
                    word: tokenText,
                });
            }
        } else {
            // No token-level data: fall back to treating the whole segment text as one word entry
            // so the compact transcript JSON still captures timing for the segment
            words.push({
                end_ms: endMs,
                start_ms: startMs,
                word: text,
            });
        }
    }

    return { language, segments, words };
}
