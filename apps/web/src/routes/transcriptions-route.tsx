import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getTranscriptions } from '@/lib/api';
import { formatTranscriptPreview } from '@/lib/transcript-format';
import { formatDate } from '@/lib/ui-utils';

const QUERY_KEYS = {
    channels: ['transcript-channels'] as const,
    transcripts: (query: string, channelId: string) => ['transcripts', query, channelId] as const,
};

type SortKey = 'title' | 'language' | 'hasAudio' | 'createdAt';
type SortDirection = 'asc' | 'desc';

export function TranscriptionsRoute() {
    const [transcriptSearchInput, setTranscriptSearchInput] = useState('');
    const [transcriptQuery, setTranscriptQuery] = useState('');
    const [channelFilter, setChannelFilter] = useState<string>('all');
    const [sortKey, setSortKey] = useState<SortKey>('createdAt');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

    const transcriptsQuery = useQuery({
        queryFn: () =>
            getTranscriptions({
                channelId: channelFilter === 'all' ? null : channelFilter,
                query: transcriptQuery,
            }),
        queryKey: QUERY_KEYS.transcripts(transcriptQuery, channelFilter),
        refetchInterval: 10_000,
    });
    const channelsQuery = useQuery({
        queryFn: () => getTranscriptions({ limit: 200 }),
        queryKey: QUERY_KEYS.channels,
        refetchInterval: 30_000,
        staleTime: 30_000,
    });

    const channelOptions = useMemo(() => {
        const unique = new Map<string, { channel: string | null; channelId: string | null }>();
        for (const item of channelsQuery.data ?? []) {
            if (!item.channelId) {
                continue;
            }
            unique.set(item.channelId, {
                channel: item.channel,
                channelId: item.channelId,
            });
        }
        return Array.from(unique.values()).sort((left, right) => {
            const leftLabel = `${left.channel ?? ''} ${left.channelId ?? ''}`.toLowerCase();
            const rightLabel = `${right.channel ?? ''} ${right.channelId ?? ''}`.toLowerCase();
            return leftLabel.localeCompare(rightLabel);
        });
    }, [channelsQuery.data]);

    const sortedTranscripts = useMemo(() => {
        const items = [...(transcriptsQuery.data ?? [])];
        const direction = sortDirection === 'asc' ? 1 : -1;

        return items.sort((left, right) => {
            switch (sortKey) {
                case 'title': {
                    const leftValue = (left.title ?? '').toLowerCase();
                    const rightValue = (right.title ?? '').toLowerCase();
                    return leftValue.localeCompare(rightValue) * direction;
                }
                case 'language':
                    return left.language.localeCompare(right.language) * direction;
                case 'hasAudio':
                    return (Number(left.hasAudio) - Number(right.hasAudio)) * direction;
                case 'createdAt':
                default:
                    return left.createdAt.localeCompare(right.createdAt) * direction;
            }
        });
    }, [sortDirection, sortKey, transcriptsQuery.data]);

    const toggleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'));
            return;
        }
        setSortKey(key);
        setSortDirection('asc');
    };

    const sortIndicator = (key: SortKey) => {
        if (sortKey !== key) {
            return '';
        }
        return sortDirection === 'asc' ? ' ↑' : ' ↓';
    };

    return (
        <Card className="min-h-[34rem]">
            <CardHeader>
                <CardTitle>Transcription Library</CardTitle>
                <CardDescription>Search by title, source URL, or transcript text.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <form
                    className="flex gap-2"
                    onSubmit={(event) => {
                        event.preventDefault();
                        setTranscriptQuery(transcriptSearchInput.trim());
                    }}
                >
                    <Input
                        placeholder="Search transcripts..."
                        value={transcriptSearchInput}
                        onChange={(event) => setTranscriptSearchInput(event.target.value)}
                    />
                    <Button type="submit" variant="outline">
                        Search
                    </Button>
                </form>
                <div className="grid gap-2 md:max-w-[30rem]">
                    <Select value={channelFilter} onValueChange={setChannelFilter}>
                        <SelectTrigger>
                            <SelectValue placeholder="Filter by channel" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All channels</SelectItem>
                            {channelOptions.map((channel) => (
                                <SelectItem key={channel.channelId} value={channel.channelId ?? ''}>
                                    {(channel.channel ?? 'Unknown channel').trim() || 'Unknown channel'} (
                                    {channel.channelId})
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {transcriptsQuery.isError ? (
                    <Alert variant="destructive">
                        <AlertTitle>Failed to load transcriptions</AlertTitle>
                        <AlertDescription>
                            {transcriptsQuery.error instanceof Error
                                ? transcriptsQuery.error.message
                                : 'Unknown API error'}
                        </AlertDescription>
                    </Alert>
                ) : null}

                <div className="max-h-[40rem] overflow-auto rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>
                                    <button
                                        className="cursor-pointer"
                                        onClick={() => toggleSort('title')}
                                        type="button"
                                    >
                                        Title{sortIndicator('title')}
                                    </button>
                                </TableHead>
                                <TableHead>
                                    <button
                                        className="cursor-pointer"
                                        onClick={() => toggleSort('language')}
                                        type="button"
                                    >
                                        Lang{sortIndicator('language')}
                                    </button>
                                </TableHead>
                                <TableHead>
                                    <button
                                        className="cursor-pointer"
                                        onClick={() => toggleSort('hasAudio')}
                                        type="button"
                                    >
                                        Audio{sortIndicator('hasAudio')}
                                    </button>
                                </TableHead>
                                <TableHead>
                                    <button
                                        className="cursor-pointer"
                                        onClick={() => toggleSort('createdAt')}
                                        type="button"
                                    >
                                        Created{sortIndicator('createdAt')}
                                    </button>
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {transcriptsQuery.isLoading ? (
                                <TableRow>
                                    <TableCell colSpan={4}>
                                        <Skeleton className="h-7 w-full" />
                                    </TableCell>
                                </TableRow>
                            ) : sortedTranscripts.length === 0 ? (
                                <TableRow>
                                    <TableCell className="text-muted-foreground" colSpan={4}>
                                        No transcriptions match this query.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                sortedTranscripts.map((item) => (
                                    <TableRow className="hover:bg-muted/30" key={item.videoId}>
                                        <TableCell className="max-w-[48ch]">
                                            <Link className="block w-full" to={`/transcriptions/${item.videoId}`}>
                                                <div className="truncate font-medium">{item.title ?? 'Untitled'}</div>
                                                <div className="text-muted-foreground text-xs">
                                                    {truncatePreview(formatTranscriptPreview(item.textPreview), 120)}
                                                </div>
                                                {item.description ? (
                                                    <div className="text-muted-foreground line-clamp-2 pt-1 text-xs">
                                                        {item.description}
                                                    </div>
                                                ) : null}
                                            </Link>
                                        </TableCell>
                                        <TableCell>
                                            <Link className="block w-full" to={`/transcriptions/${item.videoId}`}>
                                                {item.language}
                                            </Link>
                                        </TableCell>
                                        <TableCell>
                                            <Link className="block w-full" to={`/transcriptions/${item.videoId}`}>
                                                {item.hasAudio ? 'Yes' : 'No'}
                                            </Link>
                                        </TableCell>
                                        <TableCell>
                                            <Link className="block w-full" to={`/transcriptions/${item.videoId}`}>
                                                {formatDate(item.createdAt)}
                                            </Link>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
}

function truncatePreview(text: string, maxLength: number): string {
    const normalized = text.replaceAll(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, maxLength).trimEnd()}...`;
}
