'use client';

import {
    IconChevronLeft,
    IconChevronRight,
    IconChevronsLeft,
    IconChevronsRight,
    IconCircleCheckFilled,
    IconLoader,
} from '@tabler/icons-react';
import {
    type ColumnDef,
    type ColumnFiltersState,
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    type SortingState,
    useReactTable,
    type VisibilityState,
} from '@tanstack/react-table';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { AnalyticsDistribution, AnalyticsPayload, AnalyticsPoint } from '@/lib/api';

// ── Daily stats table ────────────────────────────────────────────────────────

const dailyColumns: ColumnDef<AnalyticsPoint>[] = [
    {
        accessorKey: 'day',
        cell: ({ row }) => (
            <span className="text-sm font-medium">
                {new Date(row.original.day).toLocaleDateString('en-US', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                })}
            </span>
        ),
        header: 'Date',
    },
    {
        accessorKey: 'transcripts',
        cell: ({ row }) => <div className="text-right tabular-nums">{row.original.transcripts.toLocaleString()}</div>,
        header: () => <div className="text-right">Transcripts</div>,
    },
    {
        accessorKey: 'minutes',
        cell: ({ row }) => <div className="text-right tabular-nums">{row.original.minutes.toLocaleString()}</div>,
        header: () => <div className="text-right">Minutes</div>,
    },
    {
        cell: ({ row }) => {
            const active = row.original.transcripts > 0;
            return (
                <Badge variant="outline" className="text-muted-foreground px-1.5">
                    {active ? (
                        <IconCircleCheckFilled className="fill-(--brand-primary-start)" />
                    ) : (
                        <IconLoader className="text-muted-foreground" />
                    )}
                    {active ? 'Active' : 'Idle'}
                </Badge>
            );
        },
        header: 'Activity',
        id: 'status',
    },
];

function DailyTable({ data }: { data: AnalyticsPoint[] }) {
    const reversed = React.useMemo(() => [...data].reverse(), [data]);
    const [rowSelection, setRowSelection] = React.useState({});
    const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
    const [sorting, setSorting] = React.useState<SortingState>([]);
    const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 10 });

    const table = useReactTable({
        columns: dailyColumns,
        data: reversed,
        enableRowSelection: true,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getRowId: (row) => row.day,
        getSortedRowModel: getSortedRowModel(),
        onColumnFiltersChange: setColumnFilters,
        onColumnVisibilityChange: setColumnVisibility,
        onPaginationChange: setPagination,
        onRowSelectionChange: setRowSelection,
        onSortingChange: setSorting,
        state: { columnFilters, columnVisibility, pagination, rowSelection, sorting },
    });

    return (
        <div className="flex flex-col gap-4">
            <div className="overflow-hidden rounded-lg border">
                <Table>
                    <TableHeader className="bg-muted sticky top-0 z-10">
                        {table.getHeaderGroups().map((hg) => (
                            <TableRow key={hg.id}>
                                {hg.headers.map((h) => (
                                    <TableHead key={h.id} colSpan={h.colSpan}>
                                        {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                                    </TableHead>
                                ))}
                            </TableRow>
                        ))}
                    </TableHeader>
                    <TableBody>
                        {table.getRowModel().rows.length ? (
                            table.getRowModel().rows.map((row) => (
                                <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell key={cell.id}>
                                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={dailyColumns.length} className="h-24 text-center">
                                    No daily data yet.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between px-2">
                <div className="text-muted-foreground hidden flex-1 text-sm lg:flex">
                    {table.getFilteredRowModel().rows.length} day(s) total
                </div>
                <div className="flex w-full items-center gap-8 lg:w-fit">
                    <div className="hidden items-center gap-2 lg:flex">
                        <Label htmlFor="rows-per-page" className="text-sm font-medium">
                            Rows per page
                        </Label>
                        <Select
                            value={`${table.getState().pagination.pageSize}`}
                            onValueChange={(v) => table.setPageSize(Number(v))}
                        >
                            <SelectTrigger size="sm" className="w-20" id="rows-per-page">
                                <SelectValue placeholder={table.getState().pagination.pageSize} />
                            </SelectTrigger>
                            <SelectContent side="top">
                                {[10, 20, 30].map((ps) => (
                                    <SelectItem key={ps} value={`${ps}`}>
                                        {ps}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex w-fit items-center justify-center text-sm font-medium">
                        Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
                    </div>
                    <div className="ml-auto flex items-center gap-2 lg:ml-0">
                        <Button
                            variant="outline"
                            className="hidden size-8 lg:flex"
                            size="icon"
                            onClick={() => table.setPageIndex(0)}
                            disabled={!table.getCanPreviousPage()}
                        >
                            <span className="sr-only">First page</span>
                            <IconChevronsLeft />
                        </Button>
                        <Button
                            variant="outline"
                            className="size-8"
                            size="icon"
                            onClick={() => table.previousPage()}
                            disabled={!table.getCanPreviousPage()}
                        >
                            <span className="sr-only">Previous page</span>
                            <IconChevronLeft />
                        </Button>
                        <Button
                            variant="outline"
                            className="size-8"
                            size="icon"
                            onClick={() => table.nextPage()}
                            disabled={!table.getCanNextPage()}
                        >
                            <span className="sr-only">Next page</span>
                            <IconChevronRight />
                        </Button>
                        <Button
                            variant="outline"
                            className="hidden size-8 lg:flex"
                            size="icon"
                            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                            disabled={!table.getCanNextPage()}
                        >
                            <span className="sr-only">Last page</span>
                            <IconChevronsRight />
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Distribution table ───────────────────────────────────────────────────────

function DistributionTable({ data, emptyMessage }: { data: AnalyticsDistribution[]; emptyMessage: string }) {
    if (data.length === 0) {
        return (
            <div className="text-muted-foreground flex h-32 items-center justify-center text-sm">{emptyMessage}</div>
        );
    }

    const total = data.reduce((s, d) => s + d.count, 0);

    return (
        <div className="overflow-hidden rounded-lg border">
            <Table>
                <TableHeader className="bg-muted">
                    <TableRow>
                        <TableHead>Label</TableHead>
                        <TableHead className="text-right">Count</TableHead>
                        <TableHead className="text-right">Share</TableHead>
                        <TableHead>Status</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {data.map((row) => (
                        <TableRow key={row.key}>
                            <TableCell className="font-medium capitalize">{row.key.replace(/[-_]/g, ' ')}</TableCell>
                            <TableCell className="text-right tabular-nums">{row.count.toLocaleString()}</TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                                {total > 0 ? `${((row.count / total) * 100).toFixed(1)}%` : '—'}
                            </TableCell>
                            <TableCell>
                                <Badge variant="outline" className="text-muted-foreground px-1.5">
                                    <IconCircleCheckFilled className="fill-(--brand-primary-start)" />
                                    Active
                                </Badge>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

// ── Main DataTable ────────────────────────────────────────────────────────────

export function AnalyticsDataTable({ analytics }: { analytics: AnalyticsPayload }) {
    return (
        <Tabs defaultValue="daily" className="w-full flex-col justify-start gap-6">
            {/* Toolbar */}
            <div className="flex items-center justify-between">
                {/* Mobile: select */}
                <Label htmlFor="tab-selector" className="sr-only">
                    View
                </Label>
                <Select defaultValue="daily">
                    <SelectTrigger className="flex w-fit @4xl/main:hidden" size="sm" id="tab-selector">
                        <SelectValue placeholder="Select a view" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="daily">Daily Stats</SelectItem>
                        <SelectItem value="sources">Source Mix</SelectItem>
                        <SelectItem value="languages">Languages</SelectItem>
                        <SelectItem value="enhancement">Enhancement</SelectItem>
                    </SelectContent>
                </Select>

                {/* Desktop: tab list */}
                <TabsList className="**:data-[slot=badge]:bg-muted-foreground/30 hidden **:data-[slot=badge]:size-5 **:data-[slot=badge]:rounded-full **:data-[slot=badge]:px-1 @4xl/main:flex">
                    <TabsTrigger value="daily">Daily Stats</TabsTrigger>
                    <TabsTrigger value="sources">
                        Source Mix{' '}
                        {analytics.sourceTypes.length > 0 && (
                            <Badge variant="secondary">{analytics.sourceTypes.length}</Badge>
                        )}
                    </TabsTrigger>
                    <TabsTrigger value="languages">
                        Languages{' '}
                        {analytics.languages.length > 0 && (
                            <Badge variant="secondary">{analytics.languages.length}</Badge>
                        )}
                    </TabsTrigger>
                    <TabsTrigger value="enhancement">
                        Enhancement{' '}
                        {analytics.enhancementOutcomes.length > 0 && (
                            <Badge variant="secondary">{analytics.enhancementOutcomes.length}</Badge>
                        )}
                    </TabsTrigger>
                </TabsList>
            </div>

            {/* Tab content panels */}
            <TabsContent value="daily" className="relative flex flex-col gap-4 overflow-auto">
                <DailyTable data={analytics.daily} />
            </TabsContent>

            <TabsContent value="sources" className="flex flex-col gap-4">
                <DistributionTable data={analytics.sourceTypes} emptyMessage="No source type data yet." />
            </TabsContent>

            <TabsContent value="languages" className="flex flex-col gap-4">
                <DistributionTable data={analytics.languages} emptyMessage="No language data yet." />
            </TabsContent>

            <TabsContent value="enhancement" className="flex flex-col gap-4">
                <DistributionTable
                    data={analytics.enhancementOutcomes}
                    emptyMessage="No enhancement outcome data yet."
                />
            </TabsContent>
        </Tabs>
    );
}
