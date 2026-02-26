import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getTranscriptById, resolveApiUrl } from '@/lib/api';
import { formatTranscriptSegments } from '@/lib/transcript-format';
import {
    buildWordTrackDataUri,
    findActiveWordIndex,
    formatDate,
    formatTimestampMs,
    statusClassName,
} from '@/lib/ui-utils';
import { cn } from '@/lib/utils';

const QUERY_KEYS = {
    transcript: (videoId: string) => ['transcript', videoId] as const,
};

export function TranscriptionDetailRoute() {
    const navigate = useNavigate();
    const { videoId } = useParams<{ videoId: string }>();
    const transcriptId = videoId ?? '';
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [currentAudioTimeMs, setCurrentAudioTimeMs] = useState(0);

    const transcriptDetailQuery = useQuery({
        enabled: transcriptId.length > 0,
        queryFn: () => getTranscriptById(transcriptId),
        queryKey: QUERY_KEYS.transcript(transcriptId),
        retry: 1,
    });

    const activeWordIndex = useMemo(
        () => findActiveWordIndex(transcriptDetailQuery.data?.words ?? [], currentAudioTimeMs),
        [currentAudioTimeMs, transcriptDetailQuery.data?.words],
    );
    const captionTrackUri = useMemo(
        () => buildWordTrackDataUri(transcriptDetailQuery.data?.words ?? []),
        [transcriptDetailQuery.data?.words],
    );
    const formattedSegments = useMemo(
        () => formatTranscriptSegments(transcriptDetailQuery.data?.words ?? [], transcriptDetailQuery.data?.text ?? ''),
        [transcriptDetailQuery.data?.text, transcriptDetailQuery.data?.words],
    );
    const audioUrl = transcriptDetailQuery.data?.audioUrl ? resolveApiUrl(transcriptDetailQuery.data.audioUrl) : null;

    return (
        <Card className="min-h-[34rem]">
            <CardHeader className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                    <Button onClick={() => navigate('/transcriptions')} size="sm" variant="outline">
                        Back to transcriptions
                    </Button>
                    {transcriptDetailQuery.data ? (
                        <div className="text-muted-foreground text-xs">
                            Created {formatDate(transcriptDetailQuery.data.createdAt)}
                        </div>
                    ) : null}
                </div>
                <CardTitle>Transcript Detail</CardTitle>
                <CardDescription>Full text view and word-level timeline with click-to-seek playback.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {transcriptDetailQuery.isLoading ? (
                    <div className="space-y-2">
                        <Skeleton className="h-6 w-1/2" />
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-44 w-full" />
                    </div>
                ) : transcriptDetailQuery.isError ? (
                    <Alert variant="destructive">
                        <AlertTitle>Failed to load transcript detail</AlertTitle>
                        <AlertDescription>
                            {transcriptDetailQuery.error instanceof Error
                                ? transcriptDetailQuery.error.message
                                : 'Unknown error'}
                        </AlertDescription>
                    </Alert>
                ) : transcriptDetailQuery.data ? (
                    <>
                        <div className="space-y-2">
                            <div className="text-lg font-semibold">
                                {transcriptDetailQuery.data.title ?? 'Untitled'}
                            </div>
                            <a
                                className="text-muted-foreground hover:text-primary block truncate text-xs underline decoration-dotted underline-offset-3"
                                href={transcriptDetailQuery.data.sourceUri}
                                rel="noreferrer"
                                target="_blank"
                            >
                                {transcriptDetailQuery.data.sourceUri}
                            </a>
                            <div className="flex flex-wrap gap-2 text-xs">
                                <Badge variant="secondary">{transcriptDetailQuery.data.language}</Badge>
                                <Badge className={statusClassName(transcriptDetailQuery.data.status)}>
                                    {transcriptDetailQuery.data.status}
                                </Badge>
                                <Badge variant="secondary">
                                    {transcriptDetailQuery.data.durationMs
                                        ? formatTimestampMs(transcriptDetailQuery.data.durationMs)
                                        : 'Unknown duration'}
                                </Badge>
                                <Badge variant="secondary">{transcriptDetailQuery.data.audioKind ?? 'no-audio'}</Badge>
                            </div>
                        </div>

                        {audioUrl ? (
                            <audio
                                className="w-full accent-primary"
                                controls
                                onTimeUpdate={(event) =>
                                    setCurrentAudioTimeMs(Math.round(event.currentTarget.currentTime * 1000))
                                }
                                preload="metadata"
                                ref={audioRef}
                                src={audioUrl}
                            >
                                <track
                                    default
                                    kind="captions"
                                    label="Transcript captions"
                                    src={captionTrackUri}
                                    srcLang={transcriptDetailQuery.data.language || 'en'}
                                />
                            </audio>
                        ) : (
                            <Alert>
                                <AlertTitle>Audio unavailable</AlertTitle>
                                <AlertDescription>
                                    This transcript does not currently have an accessible audio artifact.
                                </AlertDescription>
                            </Alert>
                        )}

                        <Tabs defaultValue="segments">
                            <TabsList>
                                <TabsTrigger value="segments">Segments</TabsTrigger>
                                <TabsTrigger value="word-timeline">Word timeline</TabsTrigger>
                            </TabsList>
                            <TabsContent value="segments">
                                <div className="max-h-[28rem] overflow-auto rounded-md border">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Timestamp</TableHead>
                                                <TableHead>Formatted text</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {formattedSegments.length === 0 ? (
                                                <TableRow>
                                                    <TableCell className="text-muted-foreground" colSpan={2}>
                                                        No formatted segments available.
                                                    </TableCell>
                                                </TableRow>
                                            ) : (
                                                formattedSegments.map((segment) => (
                                                    <TableRow key={segment.id}>
                                                        <TableCell className="align-top whitespace-nowrap">
                                                            <button
                                                                className="text-primary cursor-pointer rounded underline decoration-dotted underline-offset-3 disabled:cursor-not-allowed disabled:opacity-50"
                                                                disabled={!audioUrl}
                                                                onClick={() => {
                                                                    const audio = audioRef.current;
                                                                    if (!audio) {
                                                                        return;
                                                                    }
                                                                    audio.currentTime = segment.startMs / 1000;
                                                                    setCurrentAudioTimeMs(segment.startMs);
                                                                    void audio.play().catch(() => undefined);
                                                                }}
                                                                type="button"
                                                            >
                                                                {formatTimestampMs(segment.startMs)}
                                                                {' -> '}
                                                                {formatTimestampMs(segment.endMs)}
                                                            </button>
                                                        </TableCell>
                                                        <TableCell className="whitespace-pre-wrap">
                                                            {segment.text}
                                                        </TableCell>
                                                    </TableRow>
                                                ))
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>
                            </TabsContent>
                            <TabsContent value="word-timeline">
                                <div className="max-h-[28rem] overflow-auto rounded-md border bg-muted/20 p-4">
                                    {(transcriptDetailQuery.data.words ?? []).length === 0 ? (
                                        <div className="text-muted-foreground text-sm">
                                            No word timestamps found in compact transcript JSON.
                                        </div>
                                    ) : (
                                        <div className="flex flex-wrap gap-1">
                                            {transcriptDetailQuery.data.words.map((word, index) => (
                                                <button
                                                    className={cn(
                                                        'cursor-pointer rounded px-2 py-1 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                                                        index === activeWordIndex
                                                            ? 'bg-primary text-primary-foreground shadow-sm'
                                                            : 'text-foreground/80 hover:bg-primary/10 hover:text-primary',
                                                    )}
                                                    disabled={!audioUrl}
                                                    key={`${word.b}-${word.e}-${index}`}
                                                    onClick={() => {
                                                        const audio = audioRef.current;
                                                        if (!audio) {
                                                            return;
                                                        }
                                                        audio.currentTime = word.b / 1000;
                                                        setCurrentAudioTimeMs(word.b);
                                                        void audio.play().catch(() => undefined);
                                                    }}
                                                    title={`${formatTimestampMs(word.b)} → ${formatTimestampMs(word.e)}`}
                                                    type="button"
                                                >
                                                    {word.w}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </TabsContent>
                        </Tabs>
                    </>
                ) : null}
            </CardContent>
        </Card>
    );
}
