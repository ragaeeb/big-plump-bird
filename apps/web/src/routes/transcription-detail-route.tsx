import { IconLoader, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { deleteVideo, getTranscriptById, resolveApiUrl, type TranscriptDetail, type TranscriptWord } from '@/lib/api';
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
    const queryClient = useQueryClient();
    const { videoId } = useParams<{ videoId: string }>();
    const transcriptId = videoId ?? '';
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [currentAudioTimeMs, setCurrentAudioTimeMs] = useState(0);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    const transcriptDetailQuery = useQuery({
        enabled: transcriptId.length > 0,
        queryFn: () => getTranscriptById(transcriptId),
        queryKey: QUERY_KEYS.transcript(transcriptId),
        retry: 1,
    });

    const transcript = transcriptDetailQuery.data;
    const words = transcript?.words ?? [];
    const activeWordIndex = useMemo(() => findActiveWordIndex(words, currentAudioTimeMs), [currentAudioTimeMs, words]);
    const captionTrackUri = useMemo(() => buildWordTrackDataUri(words), [words]);
    const formattedSegments = useMemo(
        () => formatTranscriptSegments(words, transcript?.text ?? ''),
        [transcript?.text, words],
    );
    const audioUrl = transcript?.audioUrl ? resolveApiUrl(transcript.audioUrl) : null;
    const deleteMutation = useMutation({
        mutationFn: () => deleteVideo(transcriptId),
        onError: (error) => {
            setDeleteError(error instanceof Error ? error.message : String(error));
        },
        onSuccess: async () => {
            setDeleteConfirmOpen(false);
            setDeleteError(null);
            await queryClient.invalidateQueries();
            navigate('/transcriptions');
        },
    });

    const seekToMs = (ms: number) => {
        const audio = audioRef.current;
        if (!audio) {
            return;
        }
        audio.currentTime = ms / 1000;
        setCurrentAudioTimeMs(ms);
        void audio.play().catch(() => undefined);
    };

    return (
        <Card className="min-h-[34rem]">
            <CardHeader className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <Button onClick={() => navigate('/transcriptions')} size="sm" variant="outline">
                            Back to transcriptions
                        </Button>
                        <Button
                            className="gap-2"
                            disabled={transcriptId.length === 0 || deleteMutation.isPending}
                            onClick={() => setDeleteConfirmOpen(true)}
                            size="sm"
                            variant="destructive"
                        >
                            {deleteMutation.isPending ? (
                                <IconLoader className="size-4 animate-spin" />
                            ) : (
                                <IconTrash className="size-4" />
                            )}
                            Delete transcription
                        </Button>
                    </div>
                    {transcript ? (
                        <div className="text-muted-foreground text-xs">Created {formatDate(transcript.createdAt)}</div>
                    ) : null}
                </div>
                <CardTitle>Transcript Detail</CardTitle>
                <CardDescription>Full text view and word-level timeline with click-to-seek playback.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {deleteError ? (
                    <Alert variant="destructive">
                        <AlertTitle>Delete failed</AlertTitle>
                        <AlertDescription>{deleteError}</AlertDescription>
                    </Alert>
                ) : null}
                <TranscriptDetailBody
                    activeWordIndex={activeWordIndex}
                    audioRef={audioRef}
                    audioUrl={audioUrl}
                    captionTrackUri={captionTrackUri}
                    formattedSegments={formattedSegments}
                    onAudioTimeUpdate={(ms) => setCurrentAudioTimeMs(ms)}
                    query={transcriptDetailQuery}
                    seekToMs={seekToMs}
                />
            </CardContent>
            <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete transcription permanently?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently remove this transcription from the database and delete all related
                            artifacts across the system.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            disabled={deleteMutation.isPending}
                            onClick={() => deleteMutation.mutate()}
                        >
                            {deleteMutation.isPending ? (
                                <span className="inline-flex items-center gap-2">
                                    <IconLoader className="size-4 animate-spin" />
                                    Deleting...
                                </span>
                            ) : (
                                'Delete permanently'
                            )}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    );
}

function TranscriptDetailBody({
    activeWordIndex,
    audioRef,
    audioUrl,
    captionTrackUri,
    formattedSegments,
    onAudioTimeUpdate,
    query,
    seekToMs,
}: {
    activeWordIndex: number;
    audioRef: React.RefObject<HTMLAudioElement | null>;
    audioUrl: string | null;
    captionTrackUri: string;
    formattedSegments: ReturnType<typeof formatTranscriptSegments>;
    onAudioTimeUpdate: (ms: number) => void;
    query: ReturnType<typeof useQuery<TranscriptDetail>>;
    seekToMs: (ms: number) => void;
}) {
    if (query.isLoading) {
        return (
            <div className="space-y-2">
                <Skeleton className="h-6 w-1/2" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-44 w-full" />
            </div>
        );
    }

    if (query.isError) {
        return (
            <Alert variant="destructive">
                <AlertTitle>Failed to load transcript detail</AlertTitle>
                <AlertDescription>
                    {query.error instanceof Error ? query.error.message : 'Unknown error'}
                </AlertDescription>
            </Alert>
        );
    }

    if (!query.data) {
        return null;
    }

    return (
        <TranscriptLoadedView
            activeWordIndex={activeWordIndex}
            audioRef={audioRef}
            audioUrl={audioUrl}
            captionTrackUri={captionTrackUri}
            formattedSegments={formattedSegments}
            onAudioTimeUpdate={onAudioTimeUpdate}
            seekToMs={seekToMs}
            transcript={query.data}
        />
    );
}

function TranscriptLoadedView({
    activeWordIndex,
    audioRef,
    audioUrl,
    captionTrackUri,
    formattedSegments,
    onAudioTimeUpdate,
    seekToMs,
    transcript,
}: {
    activeWordIndex: number;
    audioRef: React.RefObject<HTMLAudioElement | null>;
    audioUrl: string | null;
    captionTrackUri: string;
    formattedSegments: ReturnType<typeof formatTranscriptSegments>;
    onAudioTimeUpdate: (ms: number) => void;
    seekToMs: (ms: number) => void;
    transcript: TranscriptDetail;
}) {
    const isRtl = isRightToLeftLanguage(transcript.language);

    return (
        <>
            <TranscriptMetadata transcript={transcript} />
            <TranscriptAudioPlayer
                audioRef={audioRef}
                audioUrl={audioUrl}
                captionTrackUri={captionTrackUri}
                onAudioTimeUpdate={onAudioTimeUpdate}
                transcript={transcript}
            />
            <Tabs defaultValue="segments">
                <TabsList>
                    <TabsTrigger value="segments">Segments</TabsTrigger>
                    <TabsTrigger value="word-timeline">Word timeline</TabsTrigger>
                </TabsList>
                <TabsContent value="segments">
                    <TranscriptSegmentsTable
                        audioUrl={audioUrl}
                        formattedSegments={formattedSegments}
                        isRtl={isRtl}
                        seekToMs={seekToMs}
                    />
                </TabsContent>
                <TabsContent value="word-timeline">
                    <TranscriptWordTimeline
                        activeWordIndex={activeWordIndex}
                        audioUrl={audioUrl}
                        isRtl={isRtl}
                        seekToMs={seekToMs}
                        words={transcript.words}
                    />
                </TabsContent>
            </Tabs>
        </>
    );
}

function isRightToLeftLanguage(language: string): boolean {
    const normalized = language.trim().toLowerCase();
    return (
        normalized.startsWith('ar') ||
        normalized.startsWith('fa') ||
        normalized.startsWith('he') ||
        normalized.startsWith('ur')
    );
}

function TranscriptMetadata({ transcript }: { transcript: TranscriptDetail }) {
    const engineLabel = transcript.engineVersion
        ? `${transcript.engine} ${transcript.engineVersion}`
        : transcript.engine;
    const showModelBadge = transcript.model.trim().toLowerCase() !== engineLabel.trim().toLowerCase();

    return (
        <div className="space-y-2">
            <div className="text-lg font-semibold">{transcript.title ?? 'Untitled'}</div>
            <a
                className="text-muted-foreground hover:text-primary block truncate text-xs underline decoration-dotted underline-offset-3"
                href={transcript.sourceUri}
                rel="noreferrer"
                target="_blank"
            >
                {transcript.sourceUri}
            </a>
            <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="secondary">{transcript.language}</Badge>
                <Badge variant="secondary">{engineLabel}</Badge>
                {showModelBadge ? <Badge variant="secondary">{transcript.model}</Badge> : null}
                <Badge className={statusClassName(transcript.status)}>{transcript.status}</Badge>
                <Badge variant="secondary">
                    {transcript.durationMs ? formatTimestampMs(transcript.durationMs) : 'Unknown duration'}
                </Badge>
                <Badge variant="secondary">{transcript.audioKind ?? 'no-audio'}</Badge>
            </div>
        </div>
    );
}

function TranscriptAudioPlayer({
    audioRef,
    audioUrl,
    captionTrackUri,
    onAudioTimeUpdate,
    transcript,
}: {
    audioRef: React.RefObject<HTMLAudioElement | null>;
    audioUrl: string | null;
    captionTrackUri: string;
    onAudioTimeUpdate: (ms: number) => void;
    transcript: TranscriptDetail;
}) {
    if (!audioUrl) {
        return (
            <Alert>
                <AlertTitle>Audio unavailable</AlertTitle>
                <AlertDescription>
                    This transcript does not currently have an accessible audio artifact.
                </AlertDescription>
            </Alert>
        );
    }

    return (
        <audio
            className="w-full accent-primary"
            controls
            onTimeUpdate={(event) => onAudioTimeUpdate(Math.round(event.currentTarget.currentTime * 1000))}
            preload="metadata"
            ref={audioRef}
            src={audioUrl}
        >
            <track
                default
                kind="captions"
                label="Transcript captions"
                src={captionTrackUri}
                srcLang={transcript.language || 'en'}
            />
        </audio>
    );
}

function TranscriptSegmentsTable({
    audioUrl,
    formattedSegments,
    isRtl,
    seekToMs,
}: {
    audioUrl: string | null;
    formattedSegments: ReturnType<typeof formatTranscriptSegments>;
    isRtl: boolean;
    seekToMs: (ms: number) => void;
}) {
    return (
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
                                        onClick={() => seekToMs(segment.startMs)}
                                        type="button"
                                    >
                                        {formatTimestampMs(segment.startMs)}
                                        {' -> '}
                                        {formatTimestampMs(segment.endMs)}
                                    </button>
                                </TableCell>
                                <TableCell
                                    className={cn('whitespace-pre-wrap', isRtl ? 'text-right' : undefined)}
                                    dir={isRtl ? 'rtl' : 'ltr'}
                                >
                                    {segment.text}
                                </TableCell>
                            </TableRow>
                        ))
                    )}
                </TableBody>
            </Table>
        </div>
    );
}

function TranscriptWordTimeline({
    activeWordIndex,
    audioUrl,
    isRtl,
    seekToMs,
    words,
}: {
    activeWordIndex: number;
    audioUrl: string | null;
    isRtl: boolean;
    seekToMs: (ms: number) => void;
    words: TranscriptWord[];
}) {
    return (
        <div className="max-h-[28rem] overflow-auto rounded-md border bg-muted/20 p-4">
            {words.length === 0 ? (
                <div className="text-muted-foreground text-sm">
                    No word timestamps found in compact transcript JSON.
                </div>
            ) : (
                <div
                    className={cn('flex flex-wrap gap-1', isRtl ? 'justify-end text-right' : undefined)}
                    dir={isRtl ? 'rtl' : 'ltr'}
                >
                    {words.map((word, index) => (
                        <button
                            className={cn(
                                'cursor-pointer rounded px-2 py-1 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                                index === activeWordIndex
                                    ? 'bg-primary text-primary-foreground shadow-sm'
                                    : 'text-foreground/80 hover:bg-primary/10 hover:text-primary',
                            )}
                            disabled={!audioUrl}
                            key={`${word.b}-${word.e}-${index}`}
                            onClick={() => seekToMs(word.b)}
                            title={`${formatTimestampMs(word.b)} → ${formatTimestampMs(word.e)}`}
                            type="button"
                        >
                            {word.w}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
