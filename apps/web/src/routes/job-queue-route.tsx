import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDashboard } from '@/context/dashboard-context';
import { formatDate, statusClassName } from '@/lib/ui-utils';

export function JobQueueRoute() {
    const { jobsQuery } = useDashboard();

    return (
        <Card>
            <CardHeader>
                <CardTitle>Queue Status</CardTitle>
                <CardDescription>Execution queue from the running API worker process.</CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Status</TableHead>
                            <TableHead>Input</TableHead>
                            <TableHead>Created</TableHead>
                            <TableHead>Finished</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {jobsQuery.isLoading ? (
                            <TableRow>
                                <TableCell className="text-muted-foreground" colSpan={4}>
                                    Loading jobs...
                                </TableCell>
                            </TableRow>
                        ) : jobsQuery.isError ? (
                            <TableRow>
                                <TableCell className="text-destructive" colSpan={4}>
                                    {jobsQuery.error instanceof Error
                                        ? jobsQuery.error.message
                                        : 'Failed to load jobs.'}
                                </TableCell>
                            </TableRow>
                        ) : (jobsQuery.data ?? []).length === 0 ? (
                            <TableRow>
                                <TableCell className="text-muted-foreground" colSpan={4}>
                                    No jobs in queue.
                                </TableCell>
                            </TableRow>
                        ) : (
                            (jobsQuery.data ?? []).map((job) => (
                                <TableRow key={job.id}>
                                    <TableCell>
                                        <Badge className={statusClassName(job.status)}>{job.status}</Badge>
                                    </TableCell>
                                    <TableCell className="max-w-[40ch] truncate">{job.input}</TableCell>
                                    <TableCell>{formatDate(job.createdAt)}</TableCell>
                                    <TableCell>{formatDate(job.finishedAt)}</TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
