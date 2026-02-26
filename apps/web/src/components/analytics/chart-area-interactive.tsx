'use client';

import * as React from 'react';
import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { AnalyticsPoint } from '@/lib/api';

const chartConfig = {
    minutes: {
        color: 'var(--brand-secondary)',
        label: 'Minutes',
    },
    transcripts: {
        color: 'var(--brand-primary)',
        label: 'Transcripts',
    },
} satisfies ChartConfig;

export function ChartAreaInteractive({ data }: { data: AnalyticsPoint[] }) {
    const [timeRange, setTimeRange] = React.useState('90d');

    const filteredData = React.useMemo(() => {
        if (data.length === 0) {
            return [];
        }
        // Use last date in dataset as reference
        const referenceDate = new Date(data[data.length - 1].day);
        let daysToSubtract = 90;
        if (timeRange === '30d') {
            daysToSubtract = 30;
        } else if (timeRange === '7d') {
            daysToSubtract = 7;
        }
        const startDate = new Date(referenceDate);
        startDate.setDate(startDate.getDate() - daysToSubtract);
        return data
            .filter((item) => new Date(item.day) >= startDate)
            .map((item) => ({
                ...item,
                label: item.day.slice(5), // "MM-DD"
            }));
    }, [data, timeRange]);

    const rangeLabel = timeRange === '7d' ? 'last 7 days' : timeRange === '30d' ? 'last 30 days' : 'last 3 months';

    return (
        <Card className="@container/card pt-0">
            <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
                <div className="grid flex-1 gap-1">
                    <CardTitle>Transcription Activity</CardTitle>
                    <CardDescription>
                        <span className="hidden @[540px]/card:block">
                            Transcripts &amp; minutes processed — {rangeLabel}
                        </span>
                        <span className="@[540px]/card:hidden">Transcripts &amp; minutes — {rangeLabel}</span>
                    </CardDescription>
                </div>
                <CardAction>
                    <ToggleGroup
                        type="single"
                        value={timeRange}
                        onValueChange={(v) => v && setTimeRange(v)}
                        variant="outline"
                        className="hidden *:data-[slot=toggle-group-item]:!px-4 @[767px]/card:flex"
                    >
                        <ToggleGroupItem value="90d">Last 3 months</ToggleGroupItem>
                        <ToggleGroupItem value="30d">Last 30 days</ToggleGroupItem>
                        <ToggleGroupItem value="7d">Last 7 days</ToggleGroupItem>
                    </ToggleGroup>
                    <Select value={timeRange} onValueChange={setTimeRange}>
                        <SelectTrigger
                            className="flex w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden"
                            size="sm"
                            aria-label="Select time range"
                        >
                            <SelectValue placeholder="Last 3 months" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl">
                            <SelectItem value="90d" className="rounded-lg">
                                Last 3 months
                            </SelectItem>
                            <SelectItem value="30d" className="rounded-lg">
                                Last 30 days
                            </SelectItem>
                            <SelectItem value="7d" className="rounded-lg">
                                Last 7 days
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </CardAction>
            </CardHeader>
            <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
                {filteredData.length === 0 ? (
                    <div className="text-muted-foreground flex h-[250px] items-center justify-center text-sm">
                        No activity data yet.
                    </div>
                ) : (
                    <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
                        <AreaChart data={filteredData}>
                            <defs>
                                <linearGradient id="fillTranscripts" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="var(--color-transcripts)" stopOpacity={0.9} />
                                    <stop offset="95%" stopColor="var(--color-transcripts)" stopOpacity={0.1} />
                                </linearGradient>
                                <linearGradient id="fillMinutes" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="var(--color-minutes)" stopOpacity={0.8} />
                                    <stop offset="95%" stopColor="var(--color-minutes)" stopOpacity={0.1} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid vertical={false} />
                            <XAxis
                                dataKey="day"
                                tickLine={false}
                                axisLine={false}
                                tickMargin={8}
                                minTickGap={32}
                                tickFormatter={(value) => {
                                    const date = new Date(value);
                                    return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
                                }}
                            />
                            <ChartTooltip
                                cursor={false}
                                content={
                                    <ChartTooltipContent
                                        labelFormatter={(value) =>
                                            new Date(value).toLocaleDateString('en-US', {
                                                day: 'numeric',
                                                month: 'short',
                                            })
                                        }
                                        indicator="dot"
                                    />
                                }
                            />
                            <Area
                                dataKey="minutes"
                                type="natural"
                                fill="url(#fillMinutes)"
                                stroke="var(--color-minutes)"
                                stackId="a"
                            />
                            <Area
                                dataKey="transcripts"
                                type="natural"
                                fill="url(#fillTranscripts)"
                                stroke="var(--color-transcripts)"
                                stackId="a"
                            />
                        </AreaChart>
                    </ChartContainer>
                )}
            </CardContent>
        </Card>
    );
}
