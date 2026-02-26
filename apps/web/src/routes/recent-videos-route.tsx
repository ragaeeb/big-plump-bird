import { IconLoader, IconRefresh, IconTrash } from '@tabler/icons-react';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDashboard } from '@/context/dashboard-context';
import { deleteVideo, retryVideo } from '@/lib/api';
import { formatDate, statusClassName } from '@/lib/ui-utils';

type PendingDelete = {
    videoId: string;
    title: string;
};

export function RecentVideosRoute() {
    const navigate = useNavigate();
    const { refreshAll, videosQuery } = useDashboard();
    const [actionError, setActionError] = useState<string | null>(null);
    const [actingOnVideoId, setActingOnVideoId] = useState<string | null>(null);
    const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

    const retryMutation = useMutation({
        mutationFn: retryVideo,
        onError: (error) => {
            setActionError(error instanceof Error ? error.message : String(error));
        },
        onMutate: (videoId) => {
            setActionError(null);
            setActingOnVideoId(videoId);
        },
        onSettled: () => {
            setActingOnVideoId(null);
            refreshAll();
        },
    });

    const deleteMutation = useMutation({
        mutationFn: deleteVideo,
        onError: (error) => {
            setActionError(error instanceof Error ? error.message : String(error));
        },
        onMutate: (videoId) => {
            setActionError(null);
            setActingOnVideoId(videoId);
        },
        onSettled: () => {
            setActingOnVideoId(null);
            refreshAll();
        },
        onSuccess: () => {
            setPendingDelete(null);
        },
    });

    const handleDeleteConfirm = () => {
        if (!pendingDelete) {
            return;
        }
        deleteMutation.mutate(pendingDelete.videoId);
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Recent Videos</CardTitle>
                <CardDescription>Last processed media files and URLs stored in SQLite.</CardDescription>
            </CardHeader>
            <CardContent>
                {actionError ? (
                    <Alert className="mb-4" variant="destructive">
                        <AlertTitle>Action failed</AlertTitle>
                        <AlertDescription>{actionError}</AlertDescription>
                    </Alert>
                ) : null}
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Status</TableHead>
                            <TableHead>Title / Source</TableHead>
                            <TableHead>Language</TableHead>
                            <TableHead>Updated</TableHead>
                            <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {(videosQuery.data ?? []).length === 0 ? (
                            <TableRow>
                                <TableCell className="text-muted-foreground" colSpan={5}>
                                    No videos yet.
                                </TableCell>
                            </TableRow>
                        ) : (
                            (videosQuery.data ?? []).map((video) => (
                                <TableRow key={video.videoId}>
                                    <TableCell>
                                        <Badge className={statusClassName(video.status)}>{video.status}</Badge>
                                    </TableCell>
                                    <TableCell className="max-w-[50ch]">
                                        <div className="truncate font-medium">{video.title ?? 'Untitled'}</div>
                                        <div className="text-muted-foreground truncate text-xs">{video.sourceUri}</div>
                                    </TableCell>
                                    <TableCell>{video.language ?? '-'}</TableCell>
                                    <TableCell>{formatDate(video.updatedAt)}</TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            {video.status === 'error' ||
                                            video.status === 'failed' ||
                                            video.status === 'processing' ? (
                                                <Button
                                                    className="gap-2"
                                                    disabled={retryMutation.isPending || deleteMutation.isPending}
                                                    onClick={() => retryMutation.mutate(video.videoId)}
                                                    size="sm"
                                                    variant="outline"
                                                >
                                                    {actingOnVideoId === video.videoId && retryMutation.isPending ? (
                                                        <IconLoader className="size-4 animate-spin" />
                                                    ) : (
                                                        <IconRefresh className="size-4" />
                                                    )}
                                                    Retry
                                                </Button>
                                            ) : (
                                                <Button
                                                    disabled={
                                                        !video.transcriptPreview ||
                                                        retryMutation.isPending ||
                                                        deleteMutation.isPending
                                                    }
                                                    onClick={() => navigate(`/transcriptions/${video.videoId}`)}
                                                    size="sm"
                                                    variant="outline"
                                                >
                                                    Open transcript
                                                </Button>
                                            )}
                                            <Button
                                                className="gap-2"
                                                disabled={retryMutation.isPending || deleteMutation.isPending}
                                                onClick={() =>
                                                    setPendingDelete({
                                                        title: video.title ?? 'Untitled',
                                                        videoId: video.videoId,
                                                    })
                                                }
                                                size="sm"
                                                variant="destructive"
                                            >
                                                {actingOnVideoId === video.videoId && deleteMutation.isPending ? (
                                                    <IconLoader className="size-4 animate-spin" />
                                                ) : (
                                                    <IconTrash className="size-4" />
                                                )}
                                                Delete
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
                <AlertDialog
                    open={pendingDelete !== null}
                    onOpenChange={(open) => {
                        if (!open) {
                            setPendingDelete(null);
                        }
                    }}
                >
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Delete Video?</AlertDialogTitle>
                            <AlertDialogDescription>
                                This will remove "{pendingDelete?.title ?? 'Untitled'}" and all associated artifacts,
                                transcripts, and temporary files.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
                            <AlertDialogAction disabled={deleteMutation.isPending} onClick={handleDeleteConfirm}>
                                {deleteMutation.isPending ? (
                                    <span className="inline-flex items-center gap-2">
                                        <IconLoader className="size-4 animate-spin" />
                                        Deleting...
                                    </span>
                                ) : (
                                    'Delete'
                                )}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </CardContent>
        </Card>
    );
}
