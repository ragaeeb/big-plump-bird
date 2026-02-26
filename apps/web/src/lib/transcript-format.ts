import {
    estimateSegmentFromToken,
    mapSegmentsIntoFormattedSegments,
    markAndCombineSegments,
    type Segment,
    type Token,
} from 'paragrafs';
import type { TranscriptWord } from '@/lib/api';

const DEFAULT_FORMAT_OPTIONS = {
    gapThreshold: 1.2,
    maxSecondsPerLine: 18,
    maxSecondsPerSegment: 42,
    minWordsPerSegment: 6,
} as const;

export type FormattedTranscriptSegment = {
    id: string;
    startMs: number;
    endMs: number;
    text: string;
};

export function formatTranscriptSegments(words: TranscriptWord[], fallbackText: string): FormattedTranscriptSegment[] {
    const sourceSegment = toSegmentFromWords(words) ?? toEstimatedSegmentFromText(fallbackText);
    if (!sourceSegment) {
        return [];
    }

    try {
        const markedSegments = markAndCombineSegments([sourceSegment], {
            gapThreshold: DEFAULT_FORMAT_OPTIONS.gapThreshold,
            maxSecondsPerSegment: DEFAULT_FORMAT_OPTIONS.maxSecondsPerSegment,
            minWordsPerSegment: DEFAULT_FORMAT_OPTIONS.minWordsPerSegment,
        });
        const formattedSegments = mapSegmentsIntoFormattedSegments(
            markedSegments,
            DEFAULT_FORMAT_OPTIONS.maxSecondsPerLine,
        );

        return formattedSegments
            .map((segment, index) => ({
                endMs: Math.round(segment.end * 1000),
                id: `${index}-${segment.start}-${segment.end}`,
                startMs: Math.round(segment.start * 1000),
                text: segment.text.trim(),
            }))
            .filter((segment) => segment.text.length > 0);
    } catch {
        const trimmedFallback = fallbackText.trim();
        if (trimmedFallback.length === 0) {
            return [];
        }
        return [
            {
                endMs: Math.max(1000, Math.round(wordCount(trimmedFallback) * 450)),
                id: 'fallback',
                startMs: 0,
                text: trimmedFallback,
            },
        ];
    }
}

export function formatTranscriptWithParagrafs(words: TranscriptWord[], fallbackText: string): string {
    const segments = formatTranscriptSegments(words, fallbackText);
    if (segments.length === 0) {
        return fallbackText;
    }
    return segments.map((segment) => segment.text).join('\n\n');
}

export function formatTranscriptPreview(text: string): string {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
        return '';
    }

    try {
        const estimatedSegment = estimateSegmentFromToken({
            end: Math.max(1, wordCount(trimmed) * 0.45),
            start: 0,
            text: trimmed,
        });
        const markedSegments = markAndCombineSegments([estimatedSegment], {
            gapThreshold: 0.8,
            maxSecondsPerSegment: 20,
            minWordsPerSegment: 4,
        });
        const formattedSegments = mapSegmentsIntoFormattedSegments(markedSegments, 10);
        const formatted = formattedSegments
            .map((segment) => segment.text.trim())
            .filter((segment) => segment.length > 0)
            .join('\n');

        return formatted.length > 0 ? formatted : trimmed;
    } catch {
        return trimmed;
    }
}

function toSegmentFromWords(words: TranscriptWord[]): Segment | null {
    const tokens: Token[] = words
        .map((word) => ({
            end: word.e / 1000,
            start: word.b / 1000,
            text: word.w.trim(),
        }))
        .filter(
            (token) =>
                token.text.length > 0 &&
                Number.isFinite(token.start) &&
                Number.isFinite(token.end) &&
                token.end >= token.start,
        );

    if (tokens.length === 0) {
        return null;
    }

    return {
        end: tokens[tokens.length - 1].end,
        start: tokens[0].start,
        text: tokens.map((token) => token.text).join(' '),
        tokens,
    };
}

function toEstimatedSegmentFromText(text: string): Segment | null {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
        return null;
    }
    return estimateSegmentFromToken({
        end: Math.max(1, wordCount(trimmed) * 0.45),
        start: 0,
        text: trimmed,
    });
}

function wordCount(text: string): number {
    return text.split(/\s+/).filter((value) => value.length > 0).length;
}
